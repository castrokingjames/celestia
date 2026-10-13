# ITransport — the dumb pipe (docs/CLIENT-SDK.md §4.2).
# GDScript has no interfaces, so the base methods assert; adapters override them.
class_name ITransport
extends RefCounted

signal entity_added(coll: StringName, id: String, snap: Dictionary)
signal entity_changed(coll: StringName, id: String, changes: Dictionary)
signal entity_removed(coll: StringName, id: String)
signal opened(server_tick: int, clock_offset_ms: int)
signal closed(code: int, reason: String)

func connect_room(_opts: Dictionary) -> void: _abstract()
func send_intent(_type: StringName, _args: Dictionary) -> void: _abstract()
func close() -> void: _abstract()
func _abstract() -> void: assert(false, "ITransport is abstract")
