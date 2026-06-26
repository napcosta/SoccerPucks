import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector


BODY_CENTER = Vector((0.0, 0.0, 1.25))
BODY_RADIUS = Vector((1.06, 0.9, 1.08))
MODEL_OBJECTS = []


def argv_after_dash():
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def ensure_dir(path):
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def material(name, color, roughness=0.65, metallic=0.0, emission=None, emission_strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_backface_culling = False
    mat.use_nodes = True

    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if emission and "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = emission
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def add_model_object(obj):
    MODEL_OBJECTS.append(obj)
    return obj


def shade_smooth(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.shade_smooth()
    finally:
        obj.select_set(False)


def add_uv_sphere(name, loc, scale, mat, segments=48, rings=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    shade_smooth(obj)
    return add_model_object(obj)


def add_cylinder(name, radius, depth, loc, mat, vertices=72, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    shade_smooth(obj)
    bevel = obj.modifiers.new(f"{name}_SoftBevel", "BEVEL")
    bevel.width = 0.08
    bevel.segments = 10
    bevel.affect = "EDGES"
    obj.modifiers.new(f"{name}_WeightedNormals", "WEIGHTED_NORMAL")
    return add_model_object(obj)


def add_tooth(name, x, y, z, sx, sy, sz, mat, rotation=0.0):
    tooth = add_uv_sphere(name, (x, y, z), (sx, sy, sz), mat, segments=28, rings=14)
    tooth.rotation_euler[1] = rotation
    return tooth


def add_squircle_tooth(name, x, y, z, width, depth, height, mat, row="top", rotation=0.0, roll=0.0):
    tooth = add_uv_sphere(name, (x, y, z), (width * 0.5, depth * 0.5, height * 0.5), mat, segments=36, rings=18)

    def soften_square(value, exponent):
        if abs(value) < 0.0001:
            return 0.0
        return math.copysign(abs(value) ** exponent, value)

    x_exponent = 0.86 if row == "top" else 0.96
    z_exponent = 0.94 if row == "top" else 1.02
    for vertex in tooth.data.vertices:
        vertex.co.x = soften_square(vertex.co.x, x_exponent)
        vertex.co.z = soften_square(vertex.co.z, z_exponent)
        if row == "top" and vertex.co.z > 0.34:
            vertex.co.z = 0.34 + (vertex.co.z - 0.34) * 0.54
        elif row == "bottom" and vertex.co.z < -0.34:
            vertex.co.z = -0.34 + (vertex.co.z + 0.34) * 0.32

    tooth.rotation_euler[1] = rotation
    tooth.rotation_euler[2] = roll
    tooth.data.update()
    return tooth


def cut_body_mouth_opening(body):
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    bm = bmesh.new()
    bm.from_mesh(body.data)
    faces_to_remove = []
    for face in bm.faces:
        world_center = body.matrix_world @ face.calc_center_median()
        if world_center.y < 0.42:
            continue
        dx = (world_center.x - 0.01) / 0.74
        dz = (world_center.z - 1.09) / 0.49
        if dx * dx + dz * dz < 1.0:
            faces_to_remove.append(face)

    if faces_to_remove:
        bmesh.ops.delete(bm, geom=faces_to_remove, context="FACES")

    bm.to_mesh(body.data)
    bm.free()
    body.data.update()
    body.select_set(False)


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def ellipse_tube_mesh(name, center, rx, rz, tube_radius, mat, segments=112, tube_segments=12):
    center = Vector(center)
    verts = []
    faces = []

    for i in range(segments):
        t = 2.0 * math.pi * i / segments
        point = Vector((rx * math.cos(t), 0.0, rz * math.sin(t))) + center
        radial = Vector((math.cos(t), 0.0, math.sin(t))).normalized()
        depth_axis = Vector((0.0, 1.0, 0.0))

        for j in range(tube_segments):
            p = 2.0 * math.pi * j / tube_segments
            verts.append(point + radial * math.cos(p) * tube_radius + depth_axis * math.sin(p) * tube_radius)

    for i in range(segments):
        ni = (i + 1) % segments
        for j in range(tube_segments):
            nj = (j + 1) % tube_segments
            faces.append((
                i * tube_segments + j,
                ni * tube_segments + j,
                ni * tube_segments + nj,
                i * tube_segments + nj,
            ))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    shade_smooth(obj)
    return add_model_object(obj)


def smile_path_point(center, rx, rz, t, wrap_depth=0.0):
    sin_t = math.sin(t)
    cos_t = math.cos(t)
    corner_lift = abs(cos_t) ** 1.9
    center_bias = 1.0 - min(1.0, abs(cos_t))
    if sin_t >= 0:
        z = center.z + rz * (sin_t * 0.305 + corner_lift * 0.47 - center_bias * center_bias * 0.012)
    else:
        z = center.z + rz * (sin_t * 0.94 + corner_lift * 0.398 + center_bias * 0.012)
    z += rz * 0.012 * cos_t * (0.55 + 0.45 * abs(sin_t))
    corner_wrap = abs(cos_t) ** 1.55
    return Vector((center.x + rx * cos_t, center.y - wrap_depth * corner_wrap, z))


def smile_mouth_fill_mesh(name, center, rx, rz, mat, segments=128, wrap_depth=0.0):
    center = Vector(center)
    verts = [center]
    faces = []

    for i in range(segments):
        t = 2.0 * math.pi * i / segments
        verts.append(smile_path_point(center, rx, rz, t, wrap_depth))

    for i in range(segments):
        faces.append((0, i + 1, 1 + ((i + 1) % segments)))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    shade_smooth(obj)
    return add_model_object(obj)


def smile_mouth_bowl_mesh(name, center, rx, rz, rim_mat, deep_mat, segments=128, rings=7, wrap_depth=0.0):
    center = Vector(center)
    verts = []
    faces = []
    mat_indices = []

    for ring in range(rings):
        blend = ring / max(1, rings - 1)
        scale = 1.0 - blend * 0.78
        ring_center = center + Vector((0.0, -0.007 * blend, -0.045 * blend))
        ring_rx = rx * scale
        ring_rz = rz * (1.0 - blend * 0.08) * scale
        ring_wrap = wrap_depth * (1.0 - blend * 0.32)

        for i in range(segments):
            t = 2.0 * math.pi * i / segments
            verts.append(smile_path_point(ring_center, ring_rx, ring_rz, t, ring_wrap))

    center_index = len(verts)
    verts.append(center + Vector((0.0, -0.009, -0.06)))

    for ring in range(rings - 1):
        row_start = ring * segments
        next_start = (ring + 1) * segments
        for i in range(segments):
            ni = (i + 1) % segments
            faces.append((row_start + i, row_start + ni, next_start + ni, next_start + i))
            mat_indices.append(0 if ring < 2 else 1)

    last_start = (rings - 1) * segments
    for i in range(segments):
        ni = (i + 1) % segments
        faces.append((center_index, last_start + i, last_start + ni))
        mat_indices.append(1)

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(rim_mat)
    obj.data.materials.append(deep_mat)
    for poly, mat_index in zip(obj.data.polygons, mat_indices):
        poly.material_index = mat_index
    shade_smooth(obj)
    return add_model_object(obj)


def smile_mouth_cavity_mesh(name, center, rx, rz, side_mat, back_mat, segments=128, depth=0.055, wrap_depth=0.0):
    center = Vector(center)
    back_center = center + Vector((0.0, -depth, -0.018))
    verts = []
    faces = []
    mat_indices = []

    for i in range(segments):
        t = 2.0 * math.pi * i / segments
        verts.append(smile_path_point(center, rx, rz, t, wrap_depth))

    for i in range(segments):
        t = 2.0 * math.pi * i / segments
        back_point = smile_path_point(back_center, rx * 0.72, rz * 0.66, t, wrap_depth * 0.45)
        verts.append(back_point)

    back_center_index = len(verts)
    verts.append(back_center)

    for i in range(segments):
        ni = (i + 1) % segments
        faces.append((i, ni, segments + ni, segments + i))
        mat_indices.append(0)

    for i in range(segments):
        ni = (i + 1) % segments
        faces.append((back_center_index, segments + i, segments + ni))
        mat_indices.append(1)

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(side_mat)
    obj.data.materials.append(back_mat)
    for poly, mat_index in zip(obj.data.polygons, mat_indices):
        poly.material_index = mat_index
    shade_smooth(obj)
    return add_model_object(obj)


def smile_tube_mesh(
    name,
    center,
    rx,
    rz,
    tube_radius,
    mat,
    segments=128,
    tube_segments=12,
    top_scale=1.0,
    bottom_scale=1.0,
    corner_scale=1.0,
    wrap_depth=0.0,
):
    center = Vector(center)
    verts = []
    faces = []
    depth_axis = Vector((0.0, 1.0, 0.0))

    for i in range(segments):
        t = 2.0 * math.pi * i / segments
        point = smile_path_point(center, rx, rz, t, wrap_depth)
        prev_point = smile_path_point(center, rx, rz, t - (2.0 * math.pi / segments), wrap_depth)
        next_point = smile_path_point(center, rx, rz, t + (2.0 * math.pi / segments), wrap_depth)
        tangent = (next_point - prev_point).normalized()
        normal_2d = depth_axis.cross(tangent).normalized()
        sin_t = math.sin(t)
        corner_blend = abs(math.cos(t)) ** 2.0 * 0.5
        base_scale = top_scale if sin_t >= 0 else bottom_scale
        radius = tube_radius * (base_scale * (1.0 - corner_blend) + corner_scale * corner_blend)
        radius *= 1.0 + 0.012 * math.sin(3.0 * t + 0.35)

        for j in range(tube_segments):
            p = 2.0 * math.pi * j / tube_segments
            verts.append(point + normal_2d * math.cos(p) * radius + depth_axis * math.sin(p) * radius)

    for i in range(segments):
        ni = (i + 1) % segments
        for j in range(tube_segments):
            nj = (j + 1) % tube_segments
            faces.append((
                i * tube_segments + j,
                ni * tube_segments + j,
                ni * tube_segments + nj,
                i * tube_segments + nj,
            ))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    shade_smooth(obj)
    return add_model_object(obj)


def add_fur_ribbon(verts, faces, mat_indices, base, normal, direction, length, width, material_index):
    normal = normal.normalized()
    direction = direction.normalized()
    side = direction.cross(normal)
    if side.length < 0.001:
        side = Vector((1.0, 0.0, 0.0))
    side.normalize()
    around = normal.cross(side).normalized()

    lift = normal * random.uniform(0.012, 0.035)
    bend = side * random.uniform(-0.22, 0.22) * length
    p0 = base + lift
    p1 = base + direction * (length * 0.42) + lift * 1.7 + bend * 0.35
    p2 = base + direction * length + lift * 2.1 + bend
    radii = (width, width * random.uniform(0.58, 0.76), width * 0.16)
    start = len(verts)
    sides = 5

    for point, radius in ((p0, radii[0]), (p1, radii[1]), (p2, radii[2])):
        for i in range(sides):
            angle = 2.0 * math.pi * i / sides
            verts.append(point + side * math.cos(angle) * radius + around * math.sin(angle) * radius)

    for ring in range(2):
        ring_start = start + ring * sides
        next_start = ring_start + sides
        for i in range(sides):
            faces.append((ring_start + i, ring_start + ((i + 1) % sides), next_start + ((i + 1) % sides), next_start + i))
            mat_indices.append(material_index)


def add_fur_clump(verts, faces, mat_indices, base, normal, direction, length, width, material_index):
    normal = normal.normalized()
    direction = direction.normalized()
    side = direction.cross(normal)
    if side.length < 0.001:
        side = Vector((1.0, 0.0, 0.0))
    side.normalize()

    lift = normal * random.uniform(0.025, 0.055)
    bend = side * random.uniform(-0.18, 0.18) * length
    p0 = base + lift
    p1 = base + direction * (length * 0.48) + lift * 1.35 + bend * 0.4
    p2 = base + direction * length + lift * 1.7 + bend
    widths = (width, width * random.uniform(0.56, 0.78), width * 0.08)
    start = len(verts)

    for point, radius in ((p0, widths[0]), (p1, widths[1]), (p2, widths[2])):
        verts.append(point - side * radius)
        verts.append(point + side * radius)

    faces.append((start, start + 2, start + 3, start + 1))
    faces.append((start + 2, start + 4, start + 5, start + 3))
    mat_indices.extend((material_index, material_index))


def is_face_detail_zone(local_x, local_y, local_z):
    mouth = local_y > 0.56 and abs(local_x) < 0.65 and -0.43 < local_z < 0.18
    eyes = local_y > 0.56 and -0.42 < local_x < 0.42 and 0.5 < local_z < 0.76
    return mouth or eyes


def make_fur_materials():
    return [
        material("FurDeepBlue", (0.035, 0.12, 0.27, 1), roughness=0.96),
        material("FurRoyalBlue", (0.075, 0.23, 0.46, 1), roughness=0.95),
        material("FurSoftHighlight", (0.16, 0.34, 0.60, 1), roughness=0.98),
    ]


def create_fur_mesh(fur_materials):
    random.seed(37)
    verts = []
    faces = []
    mat_indices = []

    target_count = 5200
    attempts = 0
    made = 0
    while made < target_count and attempts < target_count * 6:
        attempts += 1
        theta = random.random() * 2.0 * math.pi
        z_unit = random.uniform(-0.94, 0.98)
        ring = math.sqrt(max(0.0, 1.0 - z_unit * z_unit))
        x_unit = math.cos(theta) * ring
        y_unit = math.sin(theta) * ring

        if is_face_detail_zone(x_unit, y_unit, z_unit):
            continue

        base = BODY_CENTER + Vector((
            x_unit * BODY_RADIUS.x,
            y_unit * BODY_RADIUS.y,
            z_unit * BODY_RADIUS.z,
        ))
        normal = Vector((
            x_unit / BODY_RADIUS.x,
            y_unit / BODY_RADIUS.y,
            z_unit / BODY_RADIUS.z,
        )).normalized()

        gravity = Vector((0.0, 0.0, -1.0))
        tangent_down = gravity - normal * gravity.dot(normal)
        if tangent_down.length < 0.001:
            tangent_down = Vector((random.uniform(-1, 1), random.uniform(-1, 1), 0.0))
        tangent_down.normalize()
        side_sweep = Vector((-y_unit, x_unit, 0.0))
        if side_sweep.length > 0.001:
            side_sweep.normalize()
        direction = (
            tangent_down * random.uniform(0.72, 1.08)
            + side_sweep * random.uniform(-0.42, 0.42)
            + normal * random.uniform(0.06, 0.2)
        ).normalized()
        top_bias = max(0.0, z_unit - 0.55)
        front_bias = max(0.0, y_unit - 0.25)
        length = random.uniform(0.055, 0.155) + top_bias * 0.065 + front_bias * 0.025
        width = random.uniform(0.0026, 0.0065)
        mat_index = 0 if random.random() < 0.18 else 1 if random.random() < 0.84 else 2
        add_fur_ribbon(verts, faces, mat_indices, base, normal, direction, length, width, mat_index)
        made += 1

    clump_made = 0
    clump_attempts = 0
    while clump_made < 300 and clump_attempts < 2600:
        clump_attempts += 1
        theta = random.random() * 2.0 * math.pi
        z_unit = random.uniform(-0.82, 0.98)
        ring = math.sqrt(max(0.0, 1.0 - z_unit * z_unit))
        x_unit = math.cos(theta) * ring
        y_unit = math.sin(theta) * ring

        if is_face_detail_zone(x_unit, y_unit, z_unit):
            continue
        if y_unit > 0.45 and z_unit < 0.34:
            continue

        base = BODY_CENTER + Vector((
            x_unit * BODY_RADIUS.x,
            y_unit * BODY_RADIUS.y,
            z_unit * BODY_RADIUS.z,
        ))
        normal = Vector((
            x_unit / BODY_RADIUS.x,
            y_unit / BODY_RADIUS.y,
            z_unit / BODY_RADIUS.z,
        )).normalized()

        gravity = Vector((0.0, 0.0, -1.0))
        tangent_down = gravity - normal * gravity.dot(normal)
        if tangent_down.length < 0.001:
            tangent_down = Vector((random.uniform(-1, 1), random.uniform(-1, 1), 0.0))
        tangent_down.normalize()
        side_sweep = Vector((-y_unit, x_unit, 0.0))
        if side_sweep.length > 0.001:
            side_sweep.normalize()
        direction = (
            tangent_down * random.uniform(0.76, 1.04)
            + side_sweep * random.uniform(-0.28, 0.28)
            + normal * random.uniform(0.02, 0.14)
        ).normalized()
        top_bias = max(0.0, z_unit - 0.45)
        length = random.uniform(0.055, 0.125) + top_bias * 0.045
        width = random.uniform(0.006, 0.014)
        mat_index = 0 if random.random() < 0.18 else 1 if random.random() < 0.9 else 2
        add_fur_clump(verts, faces, mat_indices, base, normal, direction, length, width, mat_index)
        clump_made += 1

    # Deliberate shaggy bangs, hanging over the upper lip.
    for i in range(260):
        x = random.uniform(-0.75, 0.75)
        z = random.uniform(1.43, 1.72)
        y = random.uniform(0.66, 0.84)
        base = Vector((x, y, z))
        local = Vector((
            x / BODY_RADIUS.x,
            (y - BODY_CENTER.y) / BODY_RADIUS.y,
            (z - BODY_CENTER.z) / BODY_RADIUS.z,
        ))
        normal = local.normalized()
        direction = Vector((
            random.uniform(-0.26, 0.26),
            random.uniform(0.18, 0.42),
            random.uniform(-0.72, -0.24),
        )).normalized()
        length = random.uniform(0.075, 0.19)
        width = random.uniform(0.003, 0.0075)
        add_fur_ribbon(verts, faces, mat_indices, base, normal, direction, length, width, random.randrange(3))

    for i in range(240):
        x = random.uniform(-0.58, 0.58)
        edge_bias = abs(x) / 0.58
        base = Vector((
            x,
            random.uniform(0.82, 0.91),
            random.uniform(1.39, 1.52) + edge_bias * 0.035,
        ))
        local = Vector((
            x / BODY_RADIUS.x,
            (base.y - BODY_CENTER.y) / BODY_RADIUS.y,
            (base.z - BODY_CENTER.z) / BODY_RADIUS.z,
        ))
        normal = local.normalized()
        direction = Vector((
            random.uniform(-0.16, 0.16),
            random.uniform(0.08, 0.24),
            random.uniform(-0.32, -0.1),
        )).normalized()
        length = random.uniform(0.035, 0.085)
        width = random.uniform(0.0028, 0.0058)
        mat_index = 2 if random.random() < 0.34 else 1
        add_fur_ribbon(verts, faces, mat_indices, base, normal, direction, length, width, mat_index)

    # Crown fur fills the top-down silhouette with the radial shag visible in the concept sheet.
    for i in range(980):
        radial = math.sqrt(random.random()) * 0.88
        angle = random.random() * 2.0 * math.pi
        x_unit = math.cos(angle) * radial
        y_unit = math.sin(angle) * radial
        z_unit = math.sqrt(max(0.0, 1.0 - x_unit * x_unit - y_unit * y_unit))
        base = BODY_CENTER + Vector((
            x_unit * BODY_RADIUS.x,
            y_unit * BODY_RADIUS.y,
            z_unit * BODY_RADIUS.z,
        ))
        normal = Vector((
            x_unit / BODY_RADIUS.x if BODY_RADIUS.x else 0.0,
            y_unit / BODY_RADIUS.y if BODY_RADIUS.y else 0.0,
            z_unit / BODY_RADIUS.z if BODY_RADIUS.z else 1.0,
        )).normalized()
        outward = Vector((x_unit, y_unit, -0.16))
        if outward.length < 0.001:
            outward = Vector((random.uniform(-1, 1), random.uniform(-1, 1), -0.12))
        outward.normalize()
        direction = (outward * random.uniform(0.72, 1.08) + normal * random.uniform(0.04, 0.18)).normalized()
        center_bias = 1.0 - radial
        length = random.uniform(0.07, 0.165) + center_bias * 0.035
        width = random.uniform(0.003, 0.007)
        mat_index = 2 if random.random() < 0.28 else 1 if random.random() < 0.9 else 0
        add_fur_ribbon(verts, faces, mat_indices, base, normal, direction, length, width, mat_index)

    for i in range(520):
        radial = math.sqrt(random.random()) * 0.32
        angle = random.random() * 2.0 * math.pi
        x_unit = math.cos(angle) * radial
        y_unit = math.sin(angle) * radial
        z_unit = math.sqrt(max(0.0, 1.0 - x_unit * x_unit - y_unit * y_unit))
        base = BODY_CENTER + Vector((
            x_unit * BODY_RADIUS.x,
            y_unit * BODY_RADIUS.y,
            z_unit * BODY_RADIUS.z,
        ))
        normal = Vector((
            x_unit / BODY_RADIUS.x if BODY_RADIUS.x else 0.0,
            y_unit / BODY_RADIUS.y if BODY_RADIUS.y else 0.0,
            z_unit / BODY_RADIUS.z if BODY_RADIUS.z else 1.0,
        )).normalized()
        swirl = Vector((
            math.cos(angle + random.uniform(-0.42, 0.42)),
            math.sin(angle + random.uniform(-0.42, 0.42)),
            random.uniform(-0.2, 0.04),
        )).normalized()
        direction = (swirl * random.uniform(0.78, 1.08) + normal * random.uniform(0.02, 0.12)).normalized()
        length = random.uniform(0.055, 0.12)
        width = random.uniform(0.0032, 0.0068)
        mat_index = 2 if random.random() < 0.36 else 1 if random.random() < 0.92 else 0
        add_fur_ribbon(verts, faces, mat_indices, base, normal, direction, length, width, mat_index)

    # Dense front fuzz keeps the face furry while leaving the eyes and mouth readable.
    face_made = 0
    face_attempts = 0
    while face_made < 1300 and face_attempts < 6500:
        face_attempts += 1
        x_unit = random.uniform(-0.82, 0.82)
        z_unit = random.uniform(-0.08, 0.74)
        y_sq = 1.0 - x_unit * x_unit - z_unit * z_unit
        if y_sq <= 0.0:
            continue
        y_unit = math.sqrt(y_sq)

        if abs(x_unit) < 0.62 and -0.18 < z_unit < 0.24:
            continue
        if -0.46 < x_unit < 0.46 and 0.42 < z_unit < 0.76:
            continue

        base = BODY_CENTER + Vector((
            x_unit * BODY_RADIUS.x,
            y_unit * BODY_RADIUS.y,
            z_unit * BODY_RADIUS.z,
        ))
        normal = Vector((
            x_unit / BODY_RADIUS.x,
            y_unit / BODY_RADIUS.y,
            z_unit / BODY_RADIUS.z,
        )).normalized()
        direction = Vector((
            random.uniform(-0.24, 0.24),
            random.uniform(0.08, 0.34),
            random.uniform(-0.68, -0.12),
        )).normalized()
        length = random.uniform(0.045, 0.105) + max(0.0, z_unit - 0.42) * 0.03
        width = random.uniform(0.003, 0.0065)
        mat_index = 2 if random.random() < 0.32 else 1 if random.random() < 0.9 else 0
        add_fur_ribbon(verts, faces, mat_indices, base, normal, direction, length, width, mat_index)
        face_made += 1

    # Short central face fuzz fills the smooth bridge between eyes and smile.
    for i in range(420):
        x_unit = random.uniform(-0.42, 0.42)
        z_unit = random.uniform(0.16, 0.56)

        if -0.31 < x_unit < 0.34 and 0.45 < z_unit < 0.62:
            continue
        if abs(x_unit) < 0.58 and z_unit < 0.24:
            continue

        y_sq = 1.0 - x_unit * x_unit - z_unit * z_unit
        if y_sq <= 0.0:
            continue
        y_unit = math.sqrt(y_sq)
        base = BODY_CENTER + Vector((
            x_unit * BODY_RADIUS.x,
            y_unit * BODY_RADIUS.y,
            z_unit * BODY_RADIUS.z,
        ))
        normal = Vector((
            x_unit / BODY_RADIUS.x,
            y_unit / BODY_RADIUS.y,
            z_unit / BODY_RADIUS.z,
        )).normalized()
        direction = Vector((
            random.uniform(-0.12, 0.12),
            random.uniform(0.1, 0.28),
            random.uniform(-0.46, -0.16),
        )).normalized()
        length = random.uniform(0.032, 0.074)
        width = random.uniform(0.0027, 0.0055)
        mat_index = 2 if random.random() < 0.42 else 1
        add_fur_ribbon(verts, faces, mat_indices, base, normal, direction, length, width, mat_index)

    mesh = bpy.data.meshes.new("ShaggySliderFurMesh")
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.update()
    fur = bpy.data.objects.new("ShaggySliderFur", mesh)
    bpy.context.collection.objects.link(fur)
    for mat in fur_materials:
        fur.data.materials.append(mat)
    for poly, mat_index in zip(fur.data.polygons, mat_indices):
        poly.material_index = mat_index
    return add_model_object(fur)


def create_upper_lip_tufts(fur_materials):
    random.seed(84)
    verts = []
    faces = []
    mat_indices = []

    for i in range(95):
        x = random.uniform(-0.68, 0.7)
        edge_drop = abs(x) / 0.7
        base = Vector((
            x,
            random.uniform(0.9, 0.985),
            random.uniform(1.37, 1.5) + edge_drop * 0.045,
        ))
        normal = Vector((0.0, 1.0, 0.18)).normalized()
        direction = Vector((
            random.uniform(-0.16, 0.16) + x * 0.06,
            random.uniform(-0.015, 0.07),
            random.uniform(-0.23, -0.055),
        )).normalized()
        length = random.uniform(0.035, 0.105)
        width = random.uniform(0.0025, 0.006)
        mat_index = 2 if random.random() < 0.42 else 1
        add_fur_ribbon(verts, faces, mat_indices, base, normal, direction, length, width, mat_index)

    mesh = bpy.data.meshes.new("UpperLipFurTuftsMesh")
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.update()
    fur = bpy.data.objects.new("UpperLipFurTufts", mesh)
    bpy.context.collection.objects.link(fur)
    for mat in fur_materials:
        fur.data.materials.append(mat)
    for poly, mat_index in zip(fur.data.polygons, mat_indices):
        poly.material_index = mat_index
    return add_model_object(fur)


def create_plaque_spot(name, loc, scale, mat):
    spot = add_uv_sphere(name, loc, scale, mat, segments=12, rings=6)
    return spot


def create_base_pebble_texture(pebble_mat, highlight_mat):
    random.seed(128)
    for i in range(95):
        radius = math.sqrt(random.uniform(0.24, 1.0))
        angle = random.random() * 2.0 * math.pi
        x = math.cos(angle) * radius * 1.05
        y = math.sin(angle) * radius * 0.66

        if (x * x) / 0.48 + (y * y) / 0.22 < 1.0:
            continue

        size = random.uniform(0.006, 0.016)
        mat = highlight_mat if random.random() < 0.34 else pebble_mat
        pebble = add_uv_sphere(
            f"BasePebble_{i + 1}",
            (x, y, random.uniform(0.266, 0.274)),
            (size, size * random.uniform(0.7, 1.15), 0.0016),
            mat,
            segments=8,
            rings=4,
        )
        pebble.rotation_euler[2] = random.random() * math.pi


def wrapped_feature_y(x, front_y, width=0.56, depth=0.075):
    blend = min(1.0, abs(x) / width) ** 1.55
    return front_y - depth * blend


def build_character():
    fur_mats = make_fur_materials()
    body_mat = material("BodyUndercoatBlue", (0.045, 0.15, 0.31, 1), roughness=0.9)
    base_mat = material("SliderBaseTeamTint", (0.04, 0.15, 0.46, 1), roughness=0.46, metallic=0.02)
    base_side_mat = material("SliderBaseDarkRim", (0.01, 0.04, 0.14, 1), roughness=0.56)
    base_pebble_mat = material("SliderBasePebbleDark", (0.036, 0.12, 0.36, 1), roughness=0.72)
    base_pebble_highlight_mat = material("SliderBasePebbleHighlight", (0.07, 0.20, 0.52, 1), roughness=0.66)
    mouth_mat = material("DeepMouthMaroon", (0.07, 0.003, 0.026, 1), roughness=0.74)
    mouth_back_mat = material("RecessedMouthBack", (0.018, 0.0, 0.008, 1), roughness=0.86)
    mouth_floor_mat = material("LowerMouthFloorMaroon", (0.095, 0.006, 0.028, 1), roughness=0.86)
    lip_mat = material("RubberyRedLip", (0.43, 0.04, 0.052, 1), roughness=0.42)
    lip_shadow_mat = material("InnerLipCrease", (0.18, 0.012, 0.022, 1), roughness=0.66)
    tooth_shadow_mat = material("ToothSocketShadow", (0.042, 0.002, 0.018, 1), roughness=0.82)
    tooth_mat = material("IndividualWarmTeeth", (0.93, 0.885, 0.76, 1), roughness=0.4)
    tooth_center_mat = material("IndividualWarmTeethCenter", (0.94, 0.9, 0.79, 1), roughness=0.38)
    tooth_edge_mat = material("IndividualWarmTeethEdge", (0.86, 0.81, 0.68, 1), roughness=0.48)
    plaque_mat = material("PlaqueTint", (0.62, 0.54, 0.34, 1), roughness=0.85)
    eye_mat = material("GlossyEyeWhite", (0.96, 0.94, 0.88, 1), roughness=0.19)
    pupil_mat = material("GlossyBlackPupil", (0.002, 0.002, 0.003, 1), roughness=0.22)

    add_cylinder("SliderBase", 1.14, 0.235, (0, 0, 0.132), base_mat, scale=(1.0, 0.715, 1.0))
    add_cylinder("SliderBaseUnderside", 1.06, 0.072, (0, 0, 0.058), base_side_mat, scale=(1.0, 0.665, 1.0))
    create_base_pebble_texture(base_pebble_mat, base_pebble_highlight_mat)

    body = add_uv_sphere("ShaggySliderBody", BODY_CENTER, BODY_RADIUS, body_mat, segments=64, rings=32)
    cut_body_mouth_opening(body)
    create_fur_mesh(fur_mats)

    mouth_wrap = 0.31
    smile_mouth_bowl_mesh(
        "MouthDarkRecess",
        (0.01, 0.892, 1.1),
        0.705,
        0.425,
        mouth_mat,
        mouth_back_mat,
        wrap_depth=0.24,
    )
    smile_mouth_cavity_mesh(
        "MouthInterior",
        (0.01, 0.888, 1.1),
        0.72,
        0.47,
        mouth_mat,
        mouth_back_mat,
        depth=0.032,
        wrap_depth=0.2,
    )
    smile_tube_mesh(
        "RubberyRedMouthLip",
        (0.01, 0.902, 1.1),
        0.805,
        0.515,
        0.071,
        lip_mat,
        top_scale=0.86,
        bottom_scale=1.12,
        corner_scale=1.2,
        wrap_depth=mouth_wrap,
    )
    smile_tube_mesh(
        "InnerLipShadowCrease",
        (0.01, 0.872, 1.1),
        0.728,
        0.452,
        0.015,
        lip_shadow_mat,
        top_scale=0.7,
        bottom_scale=0.9,
        corner_scale=0.76,
        wrap_depth=0.24,
    )
    add_uv_sphere(
        "LowerMouthFloor",
        (0.02, 0.835, 0.805),
        (0.43, 0.014, 0.078),
        mouth_floor_mat,
        segments=48,
        rings=16,
    )
    # Top row: individual rounded caps tucked behind the upper lip.
    for idx, (x, z, width, height, rot, roll) in enumerate([
        (-0.402, 1.176, 0.164, 0.216, -0.13, -0.11),
        (-0.151, 1.132, 0.22, 0.276, -0.018, -0.018),
        (0.146, 1.138, 0.224, 0.284, 0.032, 0.03),
        (0.421, 1.184, 0.156, 0.206, 0.14, 0.1),
    ]):
        tooth_y = wrapped_feature_y(x, 0.904, width=0.76, depth=0.026)
        tooth_material = tooth_edge_mat if idx in (0, 3) else tooth_center_mat if idx == 1 else tooth_mat
        add_uv_sphere(
            f"TopToothSocketShadow_{idx + 1}",
            (x, tooth_y - 0.018, z - height * 0.02),
            (width * 0.48, 0.005, height * 0.38),
            tooth_shadow_mat,
            segments=20,
            rings=10,
        )
        add_squircle_tooth(
            f"TopTooth_{idx + 1}",
            x,
            tooth_y,
            z,
            width,
            0.1,
            height,
            tooth_material,
            "top",
            rot,
            roll,
        )

    for idx, (x, z, width, height, rot, roll) in enumerate([
        (-0.412, 0.828, 0.178, 0.198, 0.12, 0.085),
        (-0.152, 0.766, 0.232, 0.24, 0.035, 0.02),
        (0.158, 0.774, 0.218, 0.234, -0.035, -0.03),
        (0.41, 0.842, 0.174, 0.202, -0.12, -0.08),
    ]):
        tooth_y = wrapped_feature_y(x, 0.862, width=0.76, depth=0.044)
        tooth_material = tooth_edge_mat if idx in (0, 3) else tooth_center_mat if idx == 1 else tooth_mat
        add_uv_sphere(
            f"BottomToothSocketShadow_{idx + 1}",
            (x, tooth_y - 0.018, z + height * 0.01),
            (width * 0.39, 0.004, height * 0.28),
            tooth_shadow_mat,
            segments=20,
            rings=10,
        )
        add_squircle_tooth(
            f"BottomTooth_{idx + 1}",
            x,
            tooth_y,
            z,
            width,
            0.098,
            height,
            tooth_material,
            "bottom",
            rot,
            roll,
        )

    create_plaque_spot("PlaqueSpot_Top2", (-0.13, wrapped_feature_y(-0.13, 0.952, width=0.76, depth=0.026), 1.165), (0.009, 0.003, 0.0055), plaque_mat)
    create_plaque_spot("PlaqueSpot_Top3", (0.14, wrapped_feature_y(0.14, 0.952, width=0.76, depth=0.026), 1.172), (0.009, 0.003, 0.0055), plaque_mat)
    create_plaque_spot("PlaqueSpot_Bottom2", (-0.135, wrapped_feature_y(-0.135, 0.912, width=0.76, depth=0.044), 0.792), (0.008, 0.0025, 0.0045), plaque_mat)
    create_plaque_spot("PlaqueSpot_Bottom3", (0.16, wrapped_feature_y(0.16, 0.912, width=0.76, depth=0.044), 0.796), (0.008, 0.0025, 0.0045), plaque_mat)

    left_eye = add_uv_sphere("LeftGooglyEye", (-0.18, 0.905, 1.724), (0.186, 0.186, 0.186), eye_mat, segments=36, rings=18)
    right_eye = add_uv_sphere("RightGooglyEye", (0.158, 0.92, 1.772), (0.189, 0.189, 0.189), eye_mat, segments=36, rings=18)
    left_eye.rotation_euler[2] = -0.18
    right_eye.rotation_euler[2] = 0.12

    add_uv_sphere("LeftBlackPupil", (-0.125, 1.115, 1.72), (0.068, 0.012, 0.068), pupil_mat, segments=28, rings=14)
    add_uv_sphere("RightBlackPupil", (0.132, 1.131, 1.77), (0.069, 0.012, 0.069), pupil_mat, segments=28, rings=14)


def add_render_setup(render_path):
    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.color = (0.78, 0.88, 0.96)

    key_data = bpy.data.lights.new("PreviewKeyLight", "AREA")
    key = bpy.data.objects.new("PreviewKeyLight", key_data)
    bpy.context.collection.objects.link(key)
    key.location = (3.0, 4.4, 5.8)
    key.data.energy = 520
    key.data.size = 4.0

    fill_data = bpy.data.lights.new("PreviewFillLight", "POINT")
    fill = bpy.data.objects.new("PreviewFillLight", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.location = (-3.0, 3.5, 2.0)
    fill.data.energy = 70

    plane_mat = material("PreviewIceFloor", (0.72, 0.83, 0.92, 1), roughness=0.6)
    bpy.ops.mesh.primitive_plane_add(size=7, location=(0, 0, -0.005))
    plane = bpy.context.object
    plane.name = "PreviewOnlyIceFloor"
    plane.data.materials.append(plane_mat)

    cam_data = bpy.data.cameras.new("PreviewCamera")
    cam = bpy.data.objects.new("PreviewCamera", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (1.15, 6.3, 2.1)
    look_at(cam, (0, 0.35, 1.18))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 3.48
    bpy.context.scene.camera = cam

    try:
        bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        bpy.context.scene.render.engine = "BLENDER_EEVEE"
    bpy.context.scene.eevee.taa_render_samples = 64
    bpy.context.scene.render.resolution_x = 1400
    bpy.context.scene.render.resolution_y = 1000
    bpy.context.scene.render.film_transparent = False
    bpy.context.scene.view_settings.view_transform = "Filmic"
    bpy.context.scene.view_settings.look = "Medium High Contrast"
    bpy.context.scene.render.filepath = render_path


def export_glb(path):
    ensure_dir(path)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in MODEL_OBJECTS:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = MODEL_OBJECTS[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_skins=False,
        use_selection=True,
        export_apply=True,
    )


def render_preview(path):
    ensure_dir(path)
    add_render_setup(path)
    bpy.ops.render.render(write_still=True)


def render_turnaround(directory):
    os.makedirs(directory, exist_ok=True)
    cam = bpy.context.scene.camera
    if not cam:
        return

    bpy.context.scene.render.resolution_x = 980
    bpy.context.scene.render.resolution_y = 760
    views = [
        ("front", (1.15, 6.3, 2.1), (0.0, 0.35, 1.2), 3.48),
        ("side", (-6.0, 0.12, 2.0), (0.0, 0.1, 1.18), 3.35),
        ("back", (0.0, -6.2, 2.0), (0.0, -0.05, 1.18), 3.35),
        ("top", (0.02, 0.08, 6.5), (0.0, 0.0, 0.9), 2.75),
    ]

    for name, location, target, ortho_scale in views:
        cam.location = location
        look_at(cam, target)
        cam.data.ortho_scale = ortho_scale
        bpy.context.scene.render.filepath = os.path.join(directory, f"shaggy_slider_{name}.png")
        bpy.ops.render.render(write_still=True)


def main():
    args = argv_after_dash()
    glb_path = args[0] if args else os.path.join("assets", "shaggy_slider.glb")
    render_path = args[1] if len(args) > 1 else os.path.join("assets", "previews", "shaggy_slider_preview.png")
    turnaround_dir = args[2] if len(args) > 2 else None

    clear_scene()
    build_character()
    export_glb(glb_path)
    render_preview(render_path)
    if turnaround_dir:
        render_turnaround(turnaround_dir)
    print(f"EXPORTED|{glb_path}")
    print(f"RENDERED|{render_path}")
    if turnaround_dir:
        print(f"TURNAROUND|{turnaround_dir}")


if __name__ == "__main__":
    main()
