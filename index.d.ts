// TODO! many descriptions in this file have multiple purposes:
// 1. summary
// 2. reference
// 3. explaining the problem
// 4. showing ideal usage
// organize those descriptions and separate these components

/** holds a value which is automatically updated once dependencies change
 *
 * to read the value, call this object
 *
 * derived is updated lazily, once dependencies change, the derivator will only be executed again once the value is needed
 */
export interface Derived<out T> {
    (): T;

    /** returns the current value, this call does not create dependencies
     *
     * if it is called inside a derived and this value changes the derived will **not** be invalidated
     */
    now(): T;

    /** creates a new derivation using the derivator specified to transform the value */
    derive<U>(derivator: (value: T) => U): Derived<U>;
}
export const Derived: {
    /** creates a new derived, does not call the derivator immediatly, only calls it when needed,
     *
     * optionally you can pass a name for easier debugging, it will be available under the name property
     */
    new <T>(derivator: () => T): Derived<T>;
    new <T>(name: string, derivator: () => T): Derived<T>;
    prototype: Derived<any>,

    /** derives and obtains its current value, the dependencies are not tracked */
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

    /** do something when the value changes (not lazy)
     *
     * this is a primitive of the leviathan-state library and should be handled with care
     *
     * calls the function syncronously, and schedule a task to run it again when the dependencies change
     *
     * the affector will keep on affecting until the affector is garbage collected or it is cleared with `affect.clear`
     *
     * the affecteds are a list of objects or symbols that will guarantee that the affector keeps running until they are garbage collected
     *
     * if affected is `"everything"` the affect will have a global strong reference and will never be garbage collected, so it will affect forever or until affect.clear is called
     *
     * if affected is `"nothing"` the affect will be granted no references strong or weak, making it your resposibility to ensure it does not get garbage collected
     *
     * note that affected is not the dependencies to the affector, but rather, the objets that are affected by your function
     *
     * for example, if you intend update a text node on the dom with new values whenever some derived changes, the text node is the object you must pass as the affected
     *
     * another example, if you intend to log something to the console, and thus you want the affect to last forever, you could pass `"everything"` or `console.log` as the affected, these would have the same effect
     *
     * because not adding references will likely cause the affect to be prematurely stopped, in order to create one without them you must specify it explicitly with `"nothing"` since for most cases that is not what you want and would simply be bug
     *
     * multiple affecteds can be passed in
     *
     * the task scheduled is a microtask, it runs on the same loop and with the same priority as promises
     *
     * returns the same function passed in
     *
     * calling affect twice on the same function causes the task to scheduled again, in the same manner as if its dependencies had changed
     *
     * if new affecteds are specifed on subsequent calls, then they are added
     */
    affect: {
        <T extends () => void>(affected: object | symbol | "everything" | "nothing", affector: T): T;
        <T extends () => void>(...affected: [object | symbol, ...(object | symbol)[], T]): T;
        /** the opposite of affect, causes the affector configured with affect to no longer be called when dependencies change
         *
         * if a call to the affector is pending, it will run syncronously now
         */
        clear(affector: () => void): void;
    };
    /** set this property to a function to log when any `WeakRef` created by leviathan is garbage collected */
    debugLogWeakRefCleanUp: ((message: string) => void) | null,
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
    /** changes the value in state, and invalidates dependents if the new value is different from the current one */
    set<U extends T>(value: U): void;
    /** computes the new value based on the function, and invalidates dependents if the new value is different from the current one
     *
     * this **can** be called anywhere, altough the old value is read, that read won't cause a dependency
     *
     * note that if you need to do a change inside of the object,
     * like changing a property of the object or changing values of the array,
     * there is no need to call this function,
     * just get the object and mutate it directly,
     * don't clone the object unless necessary
     */
    mut<U extends T>(transform: (value: T) => U): void;
}
export const State: {
    /** creates a new state, with the value passed as the initial value,
     *
     * optionally you can pass a name for easier debugging, it will be available under the name property
     */
    new <T>(value: T): State<T>;
    new <T>(name: string, value: T): State<T>;
    prototype: State<any>;

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
     * 4. **plain arrays** (default array prototype and Array.isArray, only items and length)
     * 5. **TrackedArray and inheritors** (automatically tracked on constructor, only items and length)
     * 6. **Map** (with default prototype, only keys, values and size) *TODO!*
     * 7. **Set** (with default prototype, only items and size) *TODO!*
     * 8. **Promise** (with default prototype, only the value or rejection of the promise)
     *
     * also note that some tracking requires wrapping the object in a proxy,
     * and thus the original value may not tracked,
     * this means references created before the call to track may be used to mutate the object without leviathan noticing
     *
     * ```
     * const not_tracked = {};
     * const tracked = State.track(not_tracked);
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
    track<T>(value: T): T;

    /** like `Object.freeze` but tracks items before freezing, allowing the object to be memoized
     *
     * this is useful to create "records" also known as "data objects", while also tracking the values inside
     *
     * that allows you to create a derivation that returns objects that can still be memoized
     *
     * because without it you would be creating a new object everytime and everytime it would
     *
     * note that you can also use `Object.freeze` to create data objects, but the properties won't be tracked
     *
     * frozen objects have special handling when being compared in leviathan
     *
     * frozen objects are compared equal to other frozen objects with the same string data properties and the same prototype, however the order can vary
     *
     * when comparing to check if the dependent derivations need to update
     *
     * does not freeze recursively, just like `Object.freeze`, but tracks recursively just like `State.track`
     *
     * returns the same object passed in, does not wrap it in a proxy
     */
    freeze<T>(value: T): Readonly<T>;

    /** returns true if two values are the same, but handles frozen objects in a special way
     *
     * this function is used internally to determine if dependant derivations should be invalidated
     *
     * has the semantics of `Object.is`, but frozen objects with the same string data properties and the same prototype are compared equal
     *
     * works recursively, but may return false for self referential nested objects
     */
    is(a: any, b: any): boolean;

    /** creates a state that gives a view into a property of an object
     *
     * sometimes you want to pass a property "by reference", giving someone a state that refers to that property
     *
     * ```
     * declare function create_input(value: State<string>): HTMLInputElement;
     *
     * const my_state = State.track({
     *     username: "",
     *     password: "",
     * });
     * const username_input = create_input(my_state.username); // wrong, not passing it "by reference"
     * ```
     *
     * view allows you to create a state that when read, it reads from your property, and when it is written to, it writes to your property
     *
     * allowing you to pass properties "by reference"
     *
     * ```
     * const username_input = create_input(State.view(my_state, "username")); // correct, passing it "by reference"
     * ```
     */
    view<T extends object, K extends keyof T>(target: T, key: K): State<T[K]>;
    view<T extends object, K extends keyof T>(name: string, target: T, key: K): State<T[K]>;

    /** create a proxy state, that gives you full control over how the value is read and written
     *
     * no caching is ever done, every access to it calls the getter, calls to the set method call the setter, calls to the mut method call the getter and then the setter
     */
    proxy<T>(getter: () => T, setter: (value: T) => void): State<T>;
    proxy<T>(name: string, getter: () => T, setter: (value: T) => void): State<T>;

    /** an object that is tracked, changes to it can be noticed by derivations that use it
     *
     * you can inherit from this to allow your custom classes to have their properties tracked */
    Object: {
        new(): Object,
        (): Object,
        /** use the entire object, the current derivator will rerun if anything in the object changes
         *
         * this can be used as an optimization to avoid adding dependencies on each and every property individually by using `Derived.now` while still being correct */
        use(target: object): void;
        prototype: Object,
    };
    /** an array that is tracked, changes to it can be noticed by derivations that use it */
    Array: {
        new <T = any>(arrayLength?: number): T[];
        <T = any>(arrayLength?: number): T[];
        /** use the entire array, the current derivator will rerun if anything in the array changes
         *
         * this can be used as an optimization to avoid adding dependencies on each and every item individually by using `Derived.now` while still being correct */
        use(target: unknown[]): void;
        readonly prototype: any[];
    };
};
export namespace State {
    type Or<T> = T | Derived<T> | State<T>;
}

declare global {
    interface Array<T> {
        /** creates a new mapped array, whose values are automatically kept up to date, by calling the function whenever dependencies change and are needed
         *
         * the `$` indicates this is a special derived function that works with derived objects, and may not be exactly equivalent to their non deriving counterparts
         *
         * attempting to mutate the resulting array directly will throw errors
         *
         * method added by leviathan-state
         */
        $map<U>(derivator: (value: T, index: Derived<number>, array: T[]) => U): U[];
        $map<U, This>(derivator: (this: This, value: T, index: Derived<number>, array: T[]) => U, thisArg: This): U[];
    }
    interface Promise<T> {
        /** returns true if this promise is already resolved (has `$value`)
         *
         * calling this inside a derivation will cause the derivation to notice when the promise is resolved
         *
         * note that the value returned is updated by the tracker of leviathan state and might not be true even if the promise is resolved
         *
         * if the value is true that means the promise is resolved, but if the value is false, that doesn't mean the promise isn't resolved
         *
         * however, because it notifies on change it is completely safe and correct to call this from derivations
         *
         * method added by leviathan-state
         */
        $resolved(): this is { $value: T };
        /** returns true if this promise is already rejected (has `$error`)
         *
         * calling this inside a derivation will cause the derivation to notice when the promise is rejected
         *
         * note that the value returned is updated by the tracker of leviathan state and might not be true even if the promise is rejected
         *
         * if the value is true that means the promise is rejected, but if the value is false, that doesn't mean the promise isn't rejected
         *
         * however, because it notifies on change it is completely safe and correct to call this from derivations
         *
         * method added by leviathan-state
         */
        $rejected(): this is { $value: undefined };
        /** returns the current value, or undefined it this promise is not settled or was rejected
         *
         * using this inside a derivation will cause the derivation to notice when the promise is resolved
         *
         * note that this value is updated by the tracker of leviathan state and might not contain the value even if the promise is resolved
         *
         * if the value is here that means the promise is resolved, but if the value isn't here, that doesn't mean the promise isn't resolved
         *
         * however, because it notifies on change it is completely safe and correct to use this from derivations
         *
         * property added by leviathan-state
         */
        readonly $value: T | undefined;
        /** returns the current error, or undefined it this promise is not settled or was resolved
         *
         * using this inside a derivation will cause the derivation to notice when the promise is rejected
         *
         * note that this value is updated by the tracker of leviathan state and might not contain the value even if the promise is rejected
         *
         * if the value is here that means the promise is rejected, but if the value isn't here, that doesn't mean the promise isn't rejected
         *
         * however, because it notifies on change it is completely safe and correct to use this from derivations
         *
         * property added by leviathan-state
         */
        readonly $error: unknown;
    }
}
