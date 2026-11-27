/** Explicit commit boundaries must drain queued mutations before reading the
 * snapshot: awaiting an autosave alone can otherwise flush the previous render. */
export async function flushThingtimeSnapshot<Value>(options: {
 assertCurrent: () => void;
 drain: () => void;
 read: () => Value;
 schedule: (value: Value) => void;
 flush: () => Promise<void>;
}): Promise<void> {
 options.assertCurrent();
 options.drain();
 options.assertCurrent();
 options.schedule(options.read());
 await options.flush();
 options.assertCurrent();
}
