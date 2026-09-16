// Malformed fixture: a default export that doesn't look like a card (no
// `name` field), used to test loadCardFile's error handling at the
// dynamic-import boundary.
export default { foo: "bar" };
