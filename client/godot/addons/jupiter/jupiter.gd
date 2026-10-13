# Jupiter — the one autoload the game touches (docs/CLIENT-SDK.md). Scaffold skeleton.
# The game calls Jupiter methods and reacts to Jupiter signals; it never sees colyseus.js,
# JavaScriptBridge, tokens, or wss URLs.
extends Node

signal sdk_ready(host: StringName)
# TODO: full signal set — logged_in / connected / entity_added / ... (docs/CLIENT-SDK.md §2)

var transport: ITransport
var _host: StringName = &""

func init() -> void:
	_host = _resolve_host()
	match _host:
		&"editor_dev", &"native_dev":
			transport = NativeJsonDevTransport.new()
		_:
			# TODO: ColyseusBridgeTransport for web/telegram (docs/CLIENT-SDK.md §4.2)
			transport = NativeJsonDevTransport.new()
	sdk_ready.emit(_host)

func enter(_zone: StringName) -> void:
	if transport:
		transport.connect_room({ "endpoint": "ws://127.0.0.1:2567" })

func send_intent(type: StringName, args := {}) -> void:
	if transport:
		transport.send_intent(type, args)

func _resolve_host() -> StringName:
	if not OS.has_feature("web"):
		return &"editor_dev" if OS.has_feature("editor") else &"native_dev"
	# TODO: web-vs-telegram sniff, gated on telegram-web-app.js (docs/CLIENT-SDK.md §5)
	return &"web"
