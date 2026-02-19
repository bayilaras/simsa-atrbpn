/**
 * Express 5 types widen req.params and req.query to include string[].
 * This doesn't match our app's actual runtime behavior where these are always strings.
 * 
 * Module augmentation cannot narrow generic parameter types in Express.
 * Instead, route files should use `as string` casts when destructuring
 * req.params and req.query values.
 * 
 * Example:
 *   const id = req.params.id as string;
 *   const search = req.query.search as string | undefined;
 */
export { };
