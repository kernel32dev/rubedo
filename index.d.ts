/** holds a value which is automatically updated once dependencies change
 *
 * to read the value, call this object
 *
 * derived is updated lazily, once dependencies change, the derivator will only be executed again once the value is needed
 *
 * obtaining the value of the derived **outside** of a derivation throws an error, to obtain it while **outside** of a derivation, use the now method
 */
export interface Derived<out T> {
    (): T;

    /** returns the current value, use this to obtain the value of the derived while **outside** of derivations,
     *
     * using this method inside a derivation throws an error
     */
    now(): T;

    /** returns the current value, works outside and inside derivations, this call does not create dependencies
     *
     * if it is called inside a derived and this value changes the derived will **not** be invalidated
     *
     * this can easily lead to bugs, don't use if you don't understand the consequences of not creating dependencies
     */
    untracked(): T;

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
     *
     * can only be called inside derivations
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
    /** changes the value in state, and invalidates dependents if the new value is different from the current one
     *
     * returns the value passed in
     */
    set<U extends T>(value: U): U;
    /** computes the new value based on the function, and invalidates dependents if the new value is different from the current one
     *
     * this **can** be called anywhere, altough the old value is read, that read won't cause a dependency
     *
     * note that if you need to do a change inside of the object,
     * like changing a property of the object or changing values of the array,
     * there is no need to call this function,
     * just get the object and mutate it directly,
     * don't clone the object unless necessary
     *
     * returns the computed value passed in
     */
    mut<U extends T>(transform: (value: T) => U): U;
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

/** calls the function asyncronously, and schedule a task to run it again when the dependencies change
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

/** adds tracking to an object so leviathan can notice when it is read and written to
 *
 * leviathan can create dependency trees and update graphs without a compiler, but without a dedicated compilation step, it may need to give it a hand so it can do its job
 *
 * if something is not tracked, it means leviathan won't be able to rerun derivations when that thing changes, this can be the cause of very subtle bugs
 *
 * putting an object in a tracked object causes it to be also be tracked, in other it spreads to the best of its ability
 *
 * when tracking is first added to an object, its properties are recursively searched for more things to add tracking to
 *
 * the following things can be tracked:
 *
 * 1. **plain objects** (with default object prototype, only string properties)
 * 2. **null prototype objects** (with default null prototype, only string properties)
 * 3. **TrackedObject and inheritors** (automatically tracked on constructor, only string properties)
 * 4. **plain arrays** (default array prototype and Array.isArray, only items and length) *TODO!*
 * 5. **Map** (with default prototype, only keys, values and size) *TODO!*
 * 6. **Set** (with default prototype, only items and size) *TODO!*
 * 7. **Promise** (with default prototype, only the value or rejection of the promise) *TODO!*
 *
 * also note that some tracking requires wrapping the object in a proxy,
 * and thus the original value may not tracked,
 * this means references created before the call to track may be used to mutate the object without leviathan noticing
 *
 * ```
 * const not_tracked = {};
 * const tracked = track(not_tracked);
 * // not_tracked is still not tracked
 * ```
 * 
 * everything else is not tracked, user defined classes or any objects that are not plain are not tracked
 *
 * the return values of derivations and the values in the state class are automatically tracked
 *
 * tracking a value that is already tracked is a noop
 *
 * returns the value passed in, never throws errors
 */
export function track<T>(value: T): T;

/** an object that is tracked, you can inherit from this to allow your custom classes to have their properties tracked */
export const TrackedObject: {
    new(): Object,
    prototype: Object,
}
