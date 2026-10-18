import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLogger, configureLogging, NullSink, MultiSink, type LogEntry, type LogSink } from "./index.js";

class CaptureSink implements LogSink {
  readonly entries: LogEntry[] = [];
  emit(e: LogEntry): void {
    this.entries.push(e);
  }
}

describe("argus", () => {
  it("routes records to the configured sink with scope + level + args", () => {
    const cap = new CaptureSink();
    configureLogging({ level: "debug", sink: cap });
    createLogger("atlas:zone").info("join", { id: "x" });
    assert.equal(cap.entries.length, 1);
    assert.equal(cap.entries[0].scope, "atlas:zone");
    assert.equal(cap.entries[0].level, "info");
    assert.equal(cap.entries[0].msg, "join");
    assert.deepEqual(cap.entries[0].args, [{ id: "x" }]);
  });

  it("filters records below the configured level", () => {
    const cap = new CaptureSink();
    configureLogging({ level: "warn", sink: cap });
    const log = createLogger("s");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    assert.deepEqual(
      cap.entries.map((x) => x.level),
      ["warn", "error"],
    );
  });

  it("silent drops everything", () => {
    const cap = new CaptureSink();
    configureLogging({ level: "silent", sink: cap });
    createLogger("s").error("boom");
    assert.equal(cap.entries.length, 0);
  });

  it("child composes the scope", () => {
    const cap = new CaptureSink();
    configureLogging({ level: "debug", sink: cap });
    createLogger("atlas:zone").child("genesis").info("hi");
    assert.equal(cap.entries[0].scope, "atlas:zone:genesis");
  });

  it("the sink is swappable at runtime", () => {
    configureLogging({ level: "debug", sink: new NullSink() });
    const log = createLogger("s");
    log.info("dropped");
    const cap = new CaptureSink();
    configureLogging({ sink: cap });
    log.info("kept");
    assert.deepEqual(
      cap.entries.map((x) => x.msg),
      ["kept"],
    );
  });

  it("MultiSink fans out to every sink", () => {
    const a = new CaptureSink();
    const b = new CaptureSink();
    configureLogging({ level: "debug", sink: new MultiSink([a, b]) });
    createLogger("s").info("x");
    assert.equal(a.entries.length, 1);
    assert.equal(b.entries.length, 1);
  });
});
