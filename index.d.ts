/** holds a value which is automatically updated once dependencies change
 *
 * to read the value, call this object
 *
 * derived is updated lazily, once dependencies change, the derivator will only be executed again once the value is needed
 */
export interface Derived<out T> {
    (): T;
    /** returns the value as it is currently, without letting derivations notice,
     *
     * which means if this value changes derivations won't be called
     */
    // now(): T; // sounds like a bad time

    /** creates a new derivation using the derivator specified to transform the value */
    then<U>(derivator: (value: T) => U): Derived<U>;
}
export const Derived: {
    /** creates a new derived, does not call the derivator immediatly, only calls it when needed,
     *
     * optionally you can pass a name for easier debugging, it will be available under the name property
     */
    new <T>(derivator: () => T, name?: string): Derived<T>;
    prototype: Derived<any>,

    /** if value is a derivation, return it, otherwise, wrap it in a `Derived` that will never change
     *
     * useful to work with `T | Derived<T>` or `Derived.Or<T>` types
     */
    from<T>(value: T | Derived<T>): Derived<T>;

    /** returns value, but if you pass a derived or state, read its value
     *
     * useful to work with `T | Derived<T>` or `Derived.Or<T>` types
     */
    use<T>(value: T | Derived<T>): T;
};
export namespace Derived {
    /** a type alias to define that you expect a derivation that returns a `T`, but that a `T` is also accepted */
    type Or<T> = T | Derived<T>;
}

/** holds a value which can be changed with the set method
 *
 * this is the canonical way to represent a single value that can change, because leviathan can't track changes to local variables created with `let` and `var`
 *
 * the use of `let` and `var` can easily create bugs because of this,
 *
 * so always use `const` no matter what, and if you need mutability, create an instance of `State` instead
 */
export interface State<in out T> extends Derived<T> {
    set(value: T): void;
}
export const State: {
    /** creates a new state, with the value passed as the initial value,
     *
     * optionally you can pass a name for easier debugging, it will be available under the name property
     */
    new <T>(value: T, name?: string): State<T>;
    prototype: State<any>,
};
export namespace State {
    type Or<T> = T | Derived<T> | State<T>;
}

/** calls the function asyncronously, and tracks any tracked value the inner function depends on, when these change the callback will be called again asyncronously
 *
 * if reference is an object or symbol, the affector will only be called until the reference is garbage collected
 *
 * the task scheduled is a microtask, it runs on the same loop and with the same priority as promises
 *
 * returns the same function passed in
 */
export function react<T extends () => void>(affector: T, reference?: object | symbol | null | undefined): T;

/** the opposite of react, causes the affector configured with react to no longer be called when dependencies change */
export function ignore(affector: () => void): void;
