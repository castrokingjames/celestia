# Celestia client entry node — touches ONLY the Jupiter autoload (docs/CLIENT-SDK.md §3).
extends Node

func _ready() -> void:
	Jupiter.sdk_ready.connect(_on_sdk_ready)
	Jupiter.init()

func _on_sdk_ready(host: StringName) -> void:
	print("[jupiter] ready on host: ", host)
	# TODO: pre-auth status gate → login → enter  (docs/INFRA.md §9, docs/CLIENT-SDK.md §4)
	Jupiter.enter(&"zone")
