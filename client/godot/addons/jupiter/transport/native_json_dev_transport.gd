# NativeJsonDevTransport — plaintext JSON over WebSocketPeer, so netcode iterates from the
# in-editor Play button (JavaScriptBridge/colyseus.js are web-export-only). Scaffold skeleton.
# (docs/CLIENT-SDK.md §4.2, docs/BUILD-PLAN.md)
class_name NativeJsonDevTransport
extends ITransport

var _ws := WebSocketPeer.new()

func connect_room(opts: Dictionary) -> void:
	var url: String = opts.get("endpoint", "ws://127.0.0.1:2567")
	_ws.connect_to_url(url)
	# TODO: Jupiter drives a per-frame poll() → read frames → emit entity_* signals,
	#       seed opened(server_tick, clock_offset_ms) from a ping handshake (docs/CLIENT-SDK.md §4.3).

func send_intent(type: StringName, args: Dictionary) -> void:
	_ws.send_text(JSON.stringify({ "type": String(type), "args": args }))

func close() -> void:
	_ws.close()
