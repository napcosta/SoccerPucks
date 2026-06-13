import bpy
import sys
import os

argv = sys.argv[sys.argv.index("--") + 1:]
out_path = argv[0]
apply_modifiers = len(argv) > 1 and argv[1] == "apply"

os.makedirs(os.path.dirname(out_path), exist_ok=True)

for obj in bpy.data.objects:
    dims = obj.dimensions
    mods = ",".join(m.type for m in obj.modifiers) if hasattr(obj, "modifiers") else ""
    print("OBJ|%s|type=%s|dims=(%.3f, %.3f, %.3f)|loc=(%.3f, %.3f, %.3f)|mods=%s" % (
        obj.name, obj.type, dims.x, dims.y, dims.z,
        obj.location.x, obj.location.y, obj.location.z, mods))

for action in bpy.data.actions:
    print("ANIM|%s|frames=%.0f-%.0f" % (action.name, action.frame_range[0], action.frame_range[1]))

bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format='GLB',
    export_yup=True,
    export_animations=True,
    export_skins=True,
    export_apply=apply_modifiers,
)
print("EXPORTED|" + out_path)
