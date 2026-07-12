"""Rig-free animation bake for the Meshy-generated Shaggy Slider model.

Takes the raw Meshy .blend (one fused mesh + baked texture), classifies the
mouth / teeth / eyes by sampling the texture through the UVs, sculpts
expression shape keys matching the concept sheet's mouth articulation study,
and bakes Idle / Celebrate / Sad / Angry clips as NLA tracks so they export
as separate glTF animations (the names game.js looks up on hero models).

Usage:
    & "<blender.exe>" -b "<meshy_source.blend>" --python tools/animate_shaggy_slider.py -- ^
        "<output.glb>" ["<preview_dir>"]
"""

import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

# Match the procedural model's authored footprint (SliderBase radius 1.14).
TARGET_BASE_DIAMETER = 2.28
FPS = 24


def argv_after_dash():
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

def normalize_object():
    """Bake the raw Meshy object into the game's authoring frame.

    Pure data-level transforms: bpy.ops.object.transform_apply is
    context-sensitive and silently no-ops when run through e.g. the Blender
    MCP bridge, which left classification running in the wrong frame.
    """
    obj = bpy.data.objects["temp"]
    obj.name = "ShaggySlider"
    me = obj.data
    me.name = "ShaggySliderMesh"

    # Meshy exports the face toward -Y; the game heroes are authored facing +Y.
    me.transform(Matrix.Rotation(math.pi, 4, "Z") @ obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)

    # Split/custom normals make the glTF exporter split nearly every triangle
    # corner into its own vertex (~4x size). The sculpted fur reads fine smooth.
    if "custom_normal" in me.attributes:
        me.attributes.remove(me.attributes["custom_normal"])
    me.polygons.foreach_set("use_smooth", np.ones(len(me.polygons), dtype=bool))

    nv = len(me.vertices)
    co = np.empty(nv * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(nv, 3)
    mn, mx = co.min(axis=0), co.max(axis=0)
    scale = TARGET_BASE_DIAMETER / float(mx[0] - mn[0])
    center = (mn + mx) / 2
    offset = Vector((-center[0] * scale, -center[1] * scale, -float(mn[2]) * scale))
    me.transform(Matrix.Translation(offset) @ Matrix.Diagonal((scale, scale, scale, 1.0)))
    me.update()
    return obj


# ---------------------------------------------------------------------------
# Texture-based vertex classification
# ---------------------------------------------------------------------------

def vertex_colors_from_texture(me):
    img = next(i for i in bpy.data.images if i.size[0] > 0 and i.packed_file)
    w, h = img.size
    pixels = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(pixels)
    pixels = pixels.reshape(h, w, 4)

    n_loops = len(me.loops)
    loop_vert = np.empty(n_loops, dtype=np.int64)
    me.loops.foreach_get("vertex_index", loop_vert)
    uvs = np.empty(n_loops * 2, dtype=np.float32)
    me.uv_layers.active.data.foreach_get("uv", uvs)
    uvs = uvs.reshape(n_loops, 2)

    vert_uv = np.zeros((len(me.vertices), 2), dtype=np.float32)
    vert_uv[loop_vert] = uvs

    ix = np.clip((vert_uv[:, 0] % 1.0) * w, 0, w - 1).astype(np.int64)
    iy = np.clip((vert_uv[:, 1] % 1.0) * h, 0, h - 1).astype(np.int64)
    return pixels[iy, ix, :3], vert_uv


def classify(obj):
    me = obj.data
    nv = len(me.vertices)
    co = np.empty(nv * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(nv, 3)
    rgb, vert_uv = vertex_colors_from_texture(me)
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]

    bright = np.maximum(np.maximum(r, g), b)
    dark = np.minimum(np.minimum(r, g), b)
    front = co[:, 1] > 0.0

    is_lip = front & (r > 0.22) & (r > 1.7 * g) & (r > 1.7 * b)
    is_white = front & (dark > 0.5) & ((bright - dark) < 0.28)
    is_dark = front & (bright < 0.16) & (r >= b)

    lip_z = co[is_lip, 2]
    lip_top = float(np.percentile(lip_z, 98))
    lip_bottom = float(np.percentile(lip_z, 2))

    is_teeth = is_white & (co[:, 2] < lip_top + 0.05)
    is_eye_white = is_white & (co[:, 2] >= lip_top + 0.05)
    is_interior = is_dark & (co[:, 2] < lip_top + 0.02) & (co[:, 2] > lip_bottom - 0.1)
    is_pupil = is_dark & ~is_interior & (co[:, 2] >= lip_top)

    lip_x = co[is_lip, 0]
    mouth = {
        "cx": float(np.mean(lip_x)),
        "cz": float((lip_top + lip_bottom) / 2),
        "half_w": float((np.percentile(lip_x, 99) - np.percentile(lip_x, 1)) / 2),
        "half_h": float((lip_top - lip_bottom) / 2),
        "lip_top": lip_top,
        "lip_bottom": lip_bottom,
    }

    eye = eye_clusters(co, is_eye_white | is_pupil)
    return co, {
        "lip": is_lip,
        "teeth": is_teeth,
        "interior": is_interior,
        "eye_white": is_eye_white,
        "pupil": is_pupil,
        "fur": b > r,
        "rgb": rgb,
        "vert_uv": vert_uv,
        "mouth": mouth,
        "eyes": eye,
    }


def eye_clusters(co, eye_mask):
    """Least-squares sphere fit per eye.

    Only the front of each eyeball is visible/classified, so the vertex MEAN
    sits well forward of the true center — anything built around it floats
    off the eye like a cap brim. The algebraic sphere fit recovers the real
    center and radius from the partial cap.
    """
    eyes = []
    for side in (-1.0, 1.0):
        mask = eye_mask & (np.sign(co[:, 0]) == side)
        if np.count_nonzero(mask) < 16:
            continue
        pts = co[mask].astype(np.float64)
        a_mat = np.column_stack([2.0 * pts, np.ones(len(pts))])
        rhs = (pts**2).sum(axis=1)
        sol = np.linalg.lstsq(a_mat, rhs, rcond=None)[0]
        center = sol[:3]
        radius = float(math.sqrt(sol[3] + center.dot(center)))
        mean = pts.mean(axis=0)
        spread = float(np.percentile(np.linalg.norm(pts - mean, axis=1), 90))
        if not (0.3 * spread < radius < 4.0 * spread):
            center, radius = mean, spread  # degenerate fit fallback
        eyes.append({"center": center.astype(np.float32), "radius": radius})
    return eyes


# ---------------------------------------------------------------------------
# Eyelids
# ---------------------------------------------------------------------------

def add_eyelids(obj, co, cls):
    """Fur-colored two-part eyelids: a static dome hood plus a sliding curtain.

    The hood is a spherical cap hugging the top of the eyeball — it never
    moves and keeps the eye covered from top and 3/4-top views (a vertical
    curtain alone leaves the white eye top exposed from above). The curtain
    is a vertical-cylinder patch tucked under the hood rim; the Blink key
    slides it straight down roller-blind style (top row anchored, lower rows
    drop progressively). Translation is deliberate: a rotating lid would
    sweep a chord through the eyeball under linear morph interpolation.
    Must run BEFORE any shape keys exist.
    """
    me = obj.data

    bm = bmesh.new()
    bm.from_mesh(me)
    uv_layer = bm.loops.layers.uv.active

    lids = []
    next_index = len(me.vertices)
    rows, segs = 7, 14
    phi_max = math.radians(80)
    eye_mask = cls["eye_white"] | cls["pupil"]
    hood_rows, hood_segs = 5, 14
    hood_phi = math.radians(120)
    hood_theta = (math.radians(6), math.radians(38))

    for eye in cls["eyes"]:
        c = Vector(eye["center"])
        r = eye["radius"]

        # Paint the whole lid with a representative mid-blue fur texel: take
        # the fur vertex nearest the median blue among those around the eye
        # (nearest-vertex sampling can land on a black shadow texel).
        probe = np.array([c.x, c.y, c.z + 1.4 * r], dtype=np.float32)
        fur_ids = np.flatnonzero(cls["fur"])
        near = fur_ids[np.linalg.norm(co[fur_ids] - probe, axis=1) < 3.0 * r]
        if len(near) == 0:
            near = fur_ids
        blues = cls["rgb"][near, 2]
        fur_uv = cls["vert_uv"][near[np.argmin(np.abs(blues - np.percentile(blues, 70)))]]

        n = Vector((c.x * 0.55, c.y, 0.0)).normalized()
        u = Vector((0.0, 0.0, 1.0)).cross(n).normalized()
        up = Vector((0.0, 0.0, 1.0))

        def paint(face):
            face.smooth = True
            for loop in face.loops:
                loop[uv_layer].uv = (float(fur_uv[0]), float(fur_uv[1]))

        # Static hood: spherical cap hugging the eye top, apex + fan. The rim
        # dips lower at the outer sides (like real lid corners) to cover the
        # eye's top corners, which neither a flat rim nor the curtain reach,
        # and the azimuth edges taper inward so they don't poke out of the
        # head in profile. Two collar rows then flare out from the rim to
        # overhang the curtain's anchored top row like a lid fold: they hide
        # the parked curtain and seal the sightline between hood and curtain
        # at every blink value.
        # The cap's pole tilts up-forward: the fur face recedes behind the
        # eyeball, so a vertical-pole cap's crown floats in front of the
        # recessed fur above the eye and reads as a plate in profile. The
        # exposed patch of the googly eye faces up-forward — pointing the
        # pole there hugs the cap onto the eye and sinks its back edge into
        # the fur.
        hood_r = r * 1.04
        ch = c + n * (-0.03 * r) + up * (-0.02 * r)
        pole = (up + n * 0.6).normalized()
        n_h = (n - pole * n.dot(pole)).normalized()
        apex = bm.verts.new(tuple(ch + pole * hood_r))
        hood = []

        def rim_dir(phi):
            q = abs(phi) / hood_phi
            theta_max = hood_theta[1] + math.radians(14) * q**1.5
            # Strong end taper: the dipped rim corners must tuck against the
            # eye or they jut past the hugging curtain like a beret brim.
            rr = hood_r * (1.0 - 0.10 * q * q)
            return theta_max, rr

        for i in range(hood_rows):
            t = i / (hood_rows - 1)
            for j in range(hood_segs + 1):
                phi = -hood_phi + 2.0 * hood_phi * j / hood_segs
                theta_max, rr = rim_dir(phi)
                theta = hood_theta[0] + (theta_max - hood_theta[0]) * t
                d = (n_h * math.cos(phi) + u * math.sin(phi)) * math.sin(theta) + pole * math.cos(theta)
                hood.append(bm.verts.new(tuple(ch + d * rr)))
        total_rows = hood_rows
        for j in range(hood_segs):
            paint(bm.faces.new((apex, hood[j], hood[j + 1])))
        for i in range(total_rows - 1):
            for j in range(hood_segs):
                a = i * (hood_segs + 1) + j
                paint(bm.faces.new((hood[a], hood[a + 1], hood[a + hood_segs + 2], hood[a + hood_segs + 1])))
        next_index += 1 + total_rows * (hood_segs + 1)

        # Sliding curtain: a draped cone, not a straight cylinder. Each row
        # travels straight down by its own weight, so it only needs radial
        # clearance for its OWN travel range: the anchored top row nests
        # against the hood, lower rows flare out to clear the eye. That
        # kills both the floating "beak" of a wide cylinder and the
        # hood/curtain sightline slot, while the stretch between rows stays
        # invisible on a flat texel. Clearance is MEASURED from the
        # classified eye vertices (per eye, per row band) rather than
        # assumed spherical — the painted pupils are raised bumps and the
        # two eyes fit slightly differently.
        near_eye = eye_mask & (np.linalg.norm(co - np.asarray(c), axis=1) < 1.8 * r)
        eye_horiz = np.hypot(co[near_eye, 0] - c.x, co[near_eye, 1] - c.y)
        eye_z = co[near_eye, 2]

        # The blink is two-phase, like a real eyelid. Parked, the curtain is
        # a tilted band hugging the eye's upper-front just below the hood
        # rim — the surface is steep there, so it reads as a lid edge
        # (horizontal rings near the crown read as a flat plate: a sphere's
        # crown IS nearly flat). Phase A (BlinkOut) pops each vertex
        # straight OUTWARD to its sweep ring at unchanged height; phase B
        # (Blink) slides the rings straight down. Both phases are
        # straight-line vertex paths that leave the convex eyeball and never
        # re-enter, at any morph blend value.
        grid = []
        weights = []
        out_delta = []
        psi_lo, psi_hi = math.radians(40.0), math.radians(31.0)  # moving edge, anchored top

        # Rings around the tilted pole dip toward the front-center, so work
        # from real per-column positions, not a scalar ring height.
        def ring_points(psi):
            pts = []
            for j in range(segs + 1):
                phi = -phi_max + 2.0 * phi_max * j / segs
                q = phi / phi_max
                tuck = 1.0 - 0.02 * q**4  # tuck the end columns in
                side_t = n_h * math.cos(phi) + u * math.sin(phi)
                pts.append((ch + (side_t * math.sin(psi) + pole * math.cos(psi)) * (1.08 * r * tuck), q, tuck))
            return pts

        bottom_front_z = ring_points(psi_lo)[segs // 2][0].z
        full_drop = (bottom_front_z - c.z) / r + 1.10  # ends just below the eye

        for i in range(rows + 1):
            t = i / rows  # 0 = moving edge, 1 = anchored top
            pts = ring_points(psi_lo + (psi_hi - psi_lo) * t)
            travel = (1.0 - t) ** 1.6 * full_drop
            row_zmin = min(p[0].z for p in pts)
            row_zmax = max(p[0].z for p in pts)

            band = (eye_z >= row_zmin - travel * r - 0.05 * r) & (eye_z <= row_zmax + 0.02 * r)
            sweep_radial = 0.0
            if np.any(band):
                sweep_radial = float(np.max(eye_horiz[band])) + 0.06 * r
            sweep_radial = min(sweep_radial, 1.14 * r)
            pop_ramp = min(1.0, travel / 0.3)  # near-static rows stay parked
            row_front_z = pts[segs // 2][0].z

            for parked, q, tuck in pts:
                grid.append(bm.verts.new(tuple(parked)))
                # Pop straight out along the column's OWN horizontal heading:
                # remapping to a different azimuth frame shears the quads.
                head = Vector((parked.x - c.x, parked.y - c.y, 0.0)).normalized()
                dx = dy = 0.0
                if sweep_radial > 0.0:
                    sweep = Vector((c.x, c.y, 0.0)) + head * (sweep_radial * tuck)
                    dx = (sweep.x - parked.x) * pop_ramp
                    dy = (sweep.y - parked.y) * pop_ramp
                out_delta.append((dx, dy, 0.0))
                # The ring arcs up toward its ends; give the ends extra drop
                # (proportional to how much this row travels) so the closed
                # edge lands level instead of leaving crescents at the eye's
                # lower corners.
                equalize = (travel / full_drop) * (parked.z - row_front_z) * 0.9
                weights.append(travel * r + equalize)
        for i in range(rows):
            for j in range(segs):
                a = i * (segs + 1) + j
                paint(bm.faces.new((grid[a], grid[a + 1], grid[a + segs + 2], grid[a + segs + 1])))

        count = (rows + 1) * (segs + 1)
        lids.append({
            "indices": np.arange(next_index, next_index + count),
            "weights": np.array(weights, dtype=np.float32),
            "out_delta": np.array(out_delta, dtype=np.float32),
        })
        next_index += count

    bm.to_mesh(me)
    bm.free()
    me.update()

    # Extend the classification arrays to cover the new vertices.
    added = next_index - len(cls["fur"])
    for name in ("lip", "teeth", "interior", "eye_white", "pupil", "fur"):
        cls[name] = np.concatenate([cls[name], np.zeros(added, dtype=bool)])

    nv = len(me.vertices)
    new_co = np.empty(nv * 3, dtype=np.float32)
    me.vertices.foreach_get("co", new_co)
    return new_co.reshape(nv, 3), lids


# ---------------------------------------------------------------------------
# Deformation fields -> shape keys
# ---------------------------------------------------------------------------

def mouth_midline(co, cls):
    """Per-x-bin mean z of lip verts: follows the smile arc naturally."""
    m = cls["mouth"]
    lip_x = co[cls["lip"], 0]
    lip_z = co[cls["lip"], 2]
    bins = 20
    edges = np.linspace(m["cx"] - m["half_w"], m["cx"] + m["half_w"], bins + 1)
    centers = (edges[:-1] + edges[1:]) / 2
    mids = np.full(bins, m["cz"])
    for i in range(bins):
        sel = (lip_x >= edges[i]) & (lip_x < edges[i + 1])
        if np.count_nonzero(sel) > 8:
            mids[i] = lip_z[sel].mean()
    # light smoothing
    mids = np.convolve(np.pad(mids, 1, mode="edge"), [0.25, 0.5, 0.25], "valid")
    return lambda x: np.interp(x, centers, mids)


def mouth_weight(co, cls):
    """Continuous falloff field over the whole mouth pocket (cavity included).

    Everything the field touches deforms together — class-split blending left
    the unclassified cavity walls behind and tore the mesh open.
    """
    m = cls["mouth"]
    nx = (co[:, 0] - m["cx"]) / (m["half_w"] * 1.12)
    nz = (co[:, 2] - m["cz"]) / (m["half_h"] * 1.12)
    d = np.sqrt(nx * nx + nz * nz)
    radial = smoothstep(1.28, 0.85, d)
    y_max = co[:, 1].max()
    front_gate = smoothstep(0.1, 0.3, co[:, 1] / y_max)
    w = radial * front_gate
    # The googly eyes must never deform with the mouth.
    for eye in cls["eyes"]:
        dist = np.linalg.norm(co - eye["center"], axis=1)
        w *= 1.0 - smoothstep(eye["radius"] * 2.4, eye["radius"] * 1.2, dist)
    return w


def make_shape_key(obj, name, new_co):
    if obj.data.shape_keys is None:
        obj.shape_key_add(name="Basis", from_mix=False)
    key = obj.shape_key_add(name=name, from_mix=False)
    key.data.foreach_set("co", new_co.astype(np.float32).ravel())
    return key


def close_mouth(co, cls, w, midline, lip_f, inner_f, tuck=0.03):
    """Compress the mouth pocket vertically toward its arc midline (closes it).

    Lips keep slightly more height than teeth/cavity so the closed mouth
    reads as a lip line with everything else hidden behind it.
    """
    out = co.copy()
    mid = midline(co[:, 0])
    factor = np.full(len(co), inner_f)
    factor[cls["lip"]] = lip_f
    target_z = mid + (co[:, 2] - mid) * factor
    out[:, 2] = co[:, 2] + w * (target_z - co[:, 2])
    out[cls["teeth"], 1] -= tuck
    return out


def drop_lids(target, lids, amount):
    for lid in lids:
        target[lid["indices"], 2] -= lid["weights"] * amount


def pop_lids(target, lids, amount):
    """Phase A of the blink: push the lids out to their sweep radius."""
    for lid in lids:
        target[lid["indices"]] += lid["out_delta"] * amount


def build_expression_keys(obj, co, cls, lids):
    m = cls["mouth"]
    w = mouth_weight(co, cls)
    midline = mouth_midline(co, cls)
    xn = np.clip(np.abs(co[:, 0] - m["cx"]) / m["half_w"], 0.0, 1.3)

    # Frown (Sad): close the mouth, invert the smile arc, droopy lids.
    frown = close_mouth(co, cls, w, midline, lip_f=0.3, inner_f=0.07, tuck=0.05)
    arc = -0.2 * np.power(xn, 1.7) + 0.07
    frown[:, 2] += w * (arc - 0.05)
    frown[:, 0] -= w * (co[:, 0] - m["cx"]) * 0.06
    pop_lids(frown, lids, 1.0)
    drop_lids(frown, lids, 0.42)
    make_shape_key(obj, "Frown", frown)

    # Grit (Angry): teeth rows clench together, mouth widens, lids glare.
    grit = close_mouth(co, cls, w, midline, lip_f=0.55, inner_f=0.42, tuck=0.02)
    grit[:, 0] += w * (co[:, 0] - m["cx"]) * 0.07
    grit[:, 2] += w * (-0.07 * np.power(xn, 1.6))
    pop_lids(grit, lids, 1.0)
    drop_lids(grit, lids, 0.38)
    make_shape_key(obj, "Grit", grit)

    # SmileWide (Celebrate): opens wider, corners push up and out.
    smile = co.copy()
    mid = midline(co[:, 0])
    smile[:, 2] = co[:, 2] + w * ((mid + (co[:, 2] - mid) * 1.3) - co[:, 2])
    smile[:, 0] += w * (co[:, 0] - m["cx"]) * 0.06
    smile[:, 2] += w * 0.12 * np.power(xn, 1.5)
    make_shape_key(obj, "SmileWide", smile)

    # Two-phase blink: BlinkOut pops the lids out to sweep radius (phase A),
    # Blink slides them down (phase B). Clips must drive BlinkOut to 1
    # before raising Blink.
    blink_out = co.copy()
    pop_lids(blink_out, lids, 1.0)
    make_shape_key(obj, "BlinkOut", blink_out)

    blink = co.copy()
    drop_lids(blink, lids, 1.0)
    make_shape_key(obj, "Blink", blink)

    # Squash & Stretch: soft-body bounce above the rigid slider base.
    height = co[:, 2].max()
    pivot = height * 0.17
    body = smoothstep(pivot, pivot + 0.28, co[:, 2])

    squash = co.copy()
    squash[:, 2] += body * ((pivot + (co[:, 2] - pivot) * 0.86) - co[:, 2])
    squash[:, 0] *= 1.0 + body * 0.07
    squash[:, 1] *= 1.0 + body * 0.07
    make_shape_key(obj, "Squash", squash)

    stretch = co.copy()
    stretch[:, 2] += body * ((pivot + (co[:, 2] - pivot) * 1.1) - co[:, 2])
    stretch[:, 0] *= 1.0 - body * 0.035
    stretch[:, 1] *= 1.0 - body * 0.035
    make_shape_key(obj, "Stretch", stretch)


# ---------------------------------------------------------------------------
# Clips
# ---------------------------------------------------------------------------

def key_value(obj, name, frame, value):
    kb = obj.data.shape_keys.key_blocks[name]
    kb.value = value
    kb.keyframe_insert("value", frame=frame)


def key_object(obj, frame, loc_z=0.0, rot=(0.0, 0.0, 0.0)):
    obj.location = (0.0, 0.0, loc_z)
    obj.rotation_euler = rot
    obj.keyframe_insert("location", frame=frame)
    obj.keyframe_insert("rotation_euler", frame=frame)


def zero_all_keys(obj, frame):
    for kb in obj.data.shape_keys.key_blocks[1:]:
        key_value(obj, kb.name, frame, 0.0)


def stash_clip(obj, name):
    """Move the clip's action into same-named NLA tracks on both holders.

    Blender 5 slotted actions put the object-transform and shape-key channels
    in ONE shared action; the exporter names the glTF animation after the NLA
    track.
    """
    for holder in (obj, obj.data.shape_keys):
        ad = holder.animation_data
        if ad is None or ad.action is None:
            continue
        action = ad.action
        action.name = name
        track = ad.nla_tracks.new()
        track.name = name
        track.strips.new(name, int(action.frame_range[0]), action)
        ad.action = None


def build_clip_idle(obj):
    zero_all_keys(obj, 1)
    key_object(obj, 1)
    for f, v in ((1, 0.0), (25, 0.09), (49, 0.0), (73, 0.09), (97, 0.0)):
        key_value(obj, "Squash", f, v)
    for f, v in ((1, 0.06), (37, 0.14), (73, 0.06), (97, 0.06)):
        key_value(obj, "SmileWide", f, v)
    for f, v in ((50, 0.0), (52, 1.0), (58, 1.0), (60, 0.0)):
        key_value(obj, "BlinkOut", f, v)
    for f, v in ((52, 0.0), (55, 1.0), (58, 0.0)):
        key_value(obj, "Blink", f, v)
    stash_clip(obj, "Idle")


def build_clip_celebrate(obj):
    zero_all_keys(obj, 1)
    key_value(obj, "SmileWide", 1, 1.0)
    key_value(obj, "SmileWide", 37, 1.0)
    for f, z in ((1, 0.0), (10, 0.34), (19, 0.0), (28, 0.28), (37, 0.0)):
        key_object(obj, f, loc_z=z)
    for f, v in ((1, 0.35), (6, 0.0), (14, 0.0), (19, 0.35), (24, 0.0), (32, 0.0), (37, 0.35)):
        key_value(obj, "Squash", f, v)
    for f, v in ((1, 0.0), (10, 0.7), (19, 0.0), (28, 0.6), (37, 0.0)):
        key_value(obj, "Stretch", f, v)
    stash_clip(obj, "Celebrate")


def build_clip_sad(obj):
    zero_all_keys(obj, 1)
    for f, v in ((1, 1.0), (85, 1.0)):
        key_value(obj, "Frown", f, v)
    for f, v in ((1, 0.18), (43, 0.28), (85, 0.18)):
        key_value(obj, "Squash", f, v)
    for f, roll in ((1, 0.03), (43, -0.03), (85, 0.03)):
        key_object(obj, f, rot=(0.04, roll, 0.0))
    # Frown already holds the lids popped and 42% drooped; 0.58 more closes
    # them exactly — a full Blink on top would overshoot onto the cheek.
    for f, v in ((20, 0.0), (24, 0.58), (30, 0.0)):
        key_value(obj, "Blink", f, v)
    stash_clip(obj, "Sad")


def build_clip_angry(obj):
    zero_all_keys(obj, 1)
    for f, v in ((1, 1.0), (31, 1.0)):
        key_value(obj, "Grit", f, v)
    for i, f in enumerate(range(1, 32, 5)):
        jitter = 0.015 if i % 2 == 0 else -0.015
        key_object(obj, f, rot=(0.02, 0.0, jitter))
    for f, v in ((1, 0.12), (16, 0.2), (31, 0.12)):
        key_value(obj, "Squash", f, v)
    stash_clip(obj, "Angry")


# ---------------------------------------------------------------------------
# Export + previews
# ---------------------------------------------------------------------------

def export_glb(obj, path):
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_morph=True,
        export_morph_normal=False,
        export_skins=False,
        export_apply=False,
        use_selection=True,
    )


def look_at(o, target):
    d = Vector(target) - o.location
    o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render_previews(obj, directory):
    os.makedirs(directory, exist_ok=True)
    for track in obj.animation_data.nla_tracks:
        track.mute = True
    for track in obj.data.shape_keys.animation_data.nla_tracks:
        track.mute = True

    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.color = (0.85, 0.9, 0.95)

    sun_data = bpy.data.lights.new("Sun", "SUN")
    sun = bpy.data.objects.new("Sun", sun_data)
    bpy.context.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(55), 0, math.radians(200))
    sun.data.energy = 3.5

    key_data = bpy.data.lights.new("Key", "AREA")
    key = bpy.data.objects.new("Key", key_data)
    bpy.context.collection.objects.link(key)
    key.location = (2.0, 4.0, 3.2)
    key.data.energy = 500
    key.data.size = 4.0

    cam_data = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.9
    cam.location = (0.0, 6.0, 1.05)
    look_at(cam, (0.0, 0.0, 0.95))
    bpy.context.scene.camera = cam

    try:
        bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        bpy.context.scene.render.engine = "BLENDER_EEVEE"
    bpy.context.scene.render.resolution_x = 560
    bpy.context.scene.render.resolution_y = 560

    poses = {
        "neutral": {},
        "smile": {"SmileWide": 1.0},
        "frown": {"Frown": 1.0},
        "grit": {"Grit": 1.0},
        "blink": {"Blink": 1.0},
        "squash": {"Squash": 1.0},
    }
    for name, values in poses.items():
        for kb in obj.data.shape_keys.key_blocks[1:]:
            kb.value = values.get(kb.name, 0.0)
        bpy.context.scene.render.filepath = os.path.join(directory, f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"PREVIEW|{name}")
    for kb in obj.data.shape_keys.key_blocks[1:]:
        kb.value = 0.0


def main():
    args = argv_after_dash()
    glb_path = args[0] if args else os.path.join("assets", "shaggy_slider.glb")
    preview_dir = args[1] if len(args) > 1 else None

    bpy.context.scene.render.fps = FPS

    obj = normalize_object()
    co, cls = classify(obj)
    m = cls["mouth"]
    print(
        f"MOUTH|cx={m['cx']:.3f}|cz={m['cz']:.3f}|half_w={m['half_w']:.3f}|"
        f"half_h={m['half_h']:.3f}|eyes={len(cls['eyes'])}"
    )
    for name in ("lip", "teeth", "interior", "eye_white", "pupil"):
        print(f"CLASS|{name}|{int(np.count_nonzero(cls[name]))}")

    co, lids = add_eyelids(obj, co, cls)
    build_expression_keys(obj, co, cls, lids)
    build_clip_idle(obj)
    build_clip_celebrate(obj)
    build_clip_sad(obj)
    build_clip_angry(obj)
    export_glb(obj, glb_path)
    print(f"EXPORTED|{glb_path}")

    if preview_dir:
        render_previews(obj, preview_dir)


if __name__ == "__main__":
    main()
