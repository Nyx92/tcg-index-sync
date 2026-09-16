// Malformed fixture: a module with no default export at all, used to test
// loadCardFile's error handling at the dynamic-import boundary.
export const notACard = { foo: "bar" };
