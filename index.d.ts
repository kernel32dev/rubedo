/** holds a value which is automatically updated once dependencies change
 *
 * to read the value, call this object
 *
 * derived is updated lazily, once dependencies change, the derivator will only be executed again once the value is needed
 *
 * obtaining the value of the derived outside of a derivation throws an error, to obtain it while outside of a derivation, use the now method
 */
export interface Derived<out T> {
    (): T;
    /** returns the value as it is currently, use this to obtain the value of the derived outside of derivations,
     *
     * using this method inside a derivation throws an error
     */
    now(): T;

    /** creates a new derivation using the derivator specified to transform the value */
    then<U>(derivator: (value: T) => U): Derived<U>;
}
export const Derived: {
    /** creates a new derived, does not call the derivator immediatly, only calls it when needed,
     *
     * optionally you can pass a name for easier debugging, it will be available under the name property
     */
    new <T>(derivator: () => T): Derived<T>;
    new <T>(name: string, derivator: () => T): Derived<T>;
    prototype: Derived<any>,

    /** derives and obtains its current value, the dependencies are not tracked
     *
     * can only be called outside derivations
     */
    now<T>(derivator: () => T): T;

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
    new <T>(value: T): State<T>;
    new <T>(name: string, value: T): State<T>;
    prototype: State<any>,
};
export namespace State {
    type Or<T> = T | Derived<T> | State<T>;
}

/** calls the function asyncronously, and schedule a task to run it again if the dependencies change
 *
 * if reference is an object or symbol, the affector will only be called until the reference is garbage collected
 *
 * the task scheduled is a microtask, it runs on the same loop and with the same priority as promises
 *
 * returns the same function passed in
 *
 * calling affect twice on the same function causes the task to scheduled again, in the same manner as if its dependencies had changed
 */
export const affect: {
    <T extends () => void>(affector: T, reference?: object | symbol | null | undefined): T;
    /** the opposite of affect, causes the affector configured with affect to no longer be called when dependencies change */
    ignore(affector: () => void): void;
}
