/** **Summary**: create a new value from existing ones using a derivator function that is always up to date
 *
 * **Reference**:
 *
 * when constructed, the derivator is called synchronously and the return value is stored,
 * all uses of {@link State.track tracked values} inside become dependencies of this derivation, and if any of them change this derivation will be invalidated
 *
 * when invalidated, calling the derived object will rerun (lazy evaluation)
 *
 * however, if this derivation was only invalidated by other derivations (transitive invalidation), when called,
 * it will first check if the values of these derivations (possibly invalidated dependencies) have actually changed
 * if none have changed, then a special case is triggered where the old value is revalidated without calling the derivator
 *
 * a value is considered changed according to the semantics of {@link State.is}
 *
 * if the derived is invalidated while the derivator is running, the result of the derivator is discarded and the derivator runs again synchronously, if it repeats too many times, an error is thrown
 *
 * if specified, the name is stored in the object
 */
export interface Derived<out T> {
    (): T;

    /** **Summary**: returns the current value, without creating dependencies
     *
     * if it is called inside a derived and this value changes the derived will **not** be invalidated
     */
    now(): T;

    /** **Summary**: derive a new value from this one in a more concise and readable manner
     *
     * `a.derive(x => f(x))` is equivalent to `new Derived(() => f(a()))`
     */
    derive<U>(derivator: (value: T) => U): Derived<U>;

    /** the name specified when creating this object */
    readonly name: string;
}
export const Derived: {
    new <T>(derivator: () => T): Derived<T>;
    new <T>(name: string, derivator: () => T): Derived<T>;
    prototype: Derived<any>,

    /** **Summary**: runs a block of code without creating dependencies
     *
     * this is useful when you have a block of code somewhere that tracks dependencies such as inside an affector
     *
     * but that code is only meant to run in response to something and therefore not actually meant to create the dependencies
     */
    now<T>(derivator: () => T): T;

    /** **Summary**: turns values that may or may not be wrapped in Derived into always wrapped in Derived
     *
     * useful to work with `T | Derived<T>` or `Derived.Or<T>` types
     *
     * **Reference**: if you pass an instance of `Derived`, return it, otherwise, wrap it in a `Derived` that will never change
     */
    from<T>(value: T | Derived<T>): Derived<T>;

    /** **Summary**: turns values that may or may not be wrapped in Derived into always plain values
     *
     * useful to work with `T | Derived<T>` or `Derived.Or<T>` types
     *
     * **Reference**: returns value, but if you pass an instance of `Derived`, call it
     */
    use<T>(value: T | Derived<T>): T;

    /** set this property to a function to log when any `WeakRef` created by leviathan is garbage collected */
    debugLogWeakRefCleanUp: ((message: string) => void) | null,
};
export namespace Derived {
    /** **Summary**: a type alias to define that you expect some `T` or a derivation that returns a `T`
     *
     * use this to express that somewhere accepts derived but also accepts just the plain values for convenience
     *
     * interfaces that use this alias should **not** check if the value is an instance of State to perform mutations on it
     *
     * this type has the semantics of not mutating the value
     *
     * although do note that it accepts the exact same values as `Derived.Or`, because `State` is a subtype of `Derived`
     */
    type Or<T> = T | Derived<T>;
}

/** **Summary**: hold a single mutable value
 *
 * this is the canonical way to represent a single value that can change, because leviathan can't track changes to local variables created with `let` and `var`
 *
 * the use of `let` and `var` can easily create bugs because of this,
 *
 * so always use `const` no matter what, and if you need mutability, create an instance of `State` instead
 *
 * so for example, if you just have an object that you need to share across many different places, it might be better to just call `State.track` and share a const reference to the object like this:
 *
 * ```
 * const my_shared_state = State.track({
 *     shared_property_one: "1",
 *     shared_property_two: 2,
 *     shared_property_three: true,
 * });
 * ```
 *
 * but let's say you that you this object to maybe be null, you can't just put it in a `let` since leviathan won't be able to track it, so instead you could use an instance of the `State` class
 *
 * ```
 * const my_shared_state = new State<null | {
 *     shared_property_one: string,
 *     shared_property_two: number,
 *     shared_property_three: boolean,
 * }>(null);
 * // later on in your code:
 * my_shared_state.set({
 *     shared_property_one: "1",
 *     shared_property_two: 2,
 *     shared_property_three: true,
 * });
 * ```
 *
 * to hold state you may not necessarily need instances of `State`, you can use tracked objects too, use the State class when you need to store a primitive value
 */
export interface State<in out T> extends Derived<T> {
    /** **Summary**: changes the value in this state
     *
     * **Reference**: if the new value is different from the current one according to {@link State.is} equality, and invalidates dependents (not transitive invalidation)
     *
     * note that this function is used to change the value, if what you want is to change something inside an object contained in this `State`, you don't use this method, instead you can just mutate it directly
     *
     * don't clone the object unless necessary
     */
    set(value: T): void;
    /** **Summary**: transforms the value in this state with a function
     *
     * does not create dependencies (even though the old value is technically read)
     *
     * **Reference**: read the value without creating dependencies, and passes it to the transform function, then sets it with the same semantics as the `set` method
     *
     * note that this function is used to change the value, if what you want is to change something inside an object contained in this `State`, you don't use this method, instead you can just mutate it directly
     *
     * don't clone the object unless necessary
     */
    mut(transform: (value: T) => T): void;
    /** the name specified when creating this object */
    readonly name: string;
}
export const State: {
    new <T>(value: T): State<T>;
    new <T>(name: string, value: T): State<T>;
    prototype: State<any>;

    /** **Summary**: adds tracking to an object so leviathan can notice when it is read and written to
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
     * 6. **Map** (with default prototype, only keys, values and size)
     * 7. **Set** (with default prototype, only items and size)
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

    /** **Summary**: like `Object.freeze` but tracks items before freezing, allowing the object to be memoized
     *
     * this is useful to create "records" also known as "data objects", while also tracking the values inside
     *
     * that allows you to create a derivation that returns objects that can still be memoized
     *
     * because without it you would be creating a new object every time, invalidating dependent derivations every time
     *
     * note that you can also use `Object.freeze` to create data objects, but the properties won't be tracked (eg: wrapping objects and arrays in a proxy)
     *
     * frozen objects have special handling when being compared in leviathan
     *
     * frozen objects are compared equal to other frozen objects with the same string data properties and the same prototype, however the order can vary
     *
     * does not freeze recursively, just like `Object.freeze`, but tracks recursively just like `State.track`
     *
     * returns the same object passed in, does not wrap it in a proxy
     */
    freeze<T>(value: T): Readonly<T>;

    /** **Summary**: like `Object.is`, but uses structural equality for frozen objects
     *
     * this function is used internally to determine if dependant derivations should be invalidated
     *
     * **Reference**:
     *
     * has the semantics of `Object.is`, but frozen objects (`Object.isFrozen`) with the same string data properties and the same prototype are compared equal
     *
     * other properties are ignored
     *
     * works recursively, but may return false for self referential nested objects
     *
     * never throws, exceptions thrown in traps of the objects being compared are caught and discarded, when this happens this function returns false
     */
    is(a: any, b: any): boolean;

    /** **Summary**: creates a state that gives a view into a property of an object
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
     *
     * **Reference**: creates a State object that when called reads the property,
     * calls to the set method sets the property,
     * and calls to mut, reads the property inside of `Derived.now` and the new value sets the property
     */
    view<T extends object, K extends keyof T>(target: T, key: K): State<T[K]>;
    view<T extends object, K extends keyof T>(name: string, target: T, key: K): State<T[K]>;

    /** **Summary**: create a proxy state, that gives you full control over how the value is read and written
     *
     * no caching is ever done, every access to it calls the getter, calls to the set method call the setter, calls to the mut method call the getter and then the setter
     *
     * **Reference**: creates a State object that when called, calls the getter,
     * calls to the set call the setter
     * and calls to mut, call the getter inside of `Derived.now` and the new value is used to call the setter
     */
    proxy<T>(getter: () => T, setter: (value: T) => void): State<T>;
    proxy<T>(name: string, getter: () => T, setter: (value: T) => void): State<T>;

    /** **Summary**: an object that is tracked, changes to it can be noticed by derivations that use it
     *
     * you can inherit from this to allow your custom classes to have their properties tracked (custom classes are not tracked by default, see {@link State.track})
     *
     * you can use `instanceof State.Object` to test if an object is tracked, it also returns true for all tracked objects (`State.Object`, `State.Array`, `State.Map`, `State.Set` and `State.Promise`)
     *
     * **Reference**: creates a new object with the correct prototype and already wrapped in a proxy
     */
    Object: {
        new(): Object;
        (): Object;
        /** **Summary**: use the entire object, the current derivator will rerun if anything in the object changes
         *
         * this can be used as an optimization to avoid adding dependencies on each and every property individually by using `Derived.now` while still being correct
         *
         * **Reference**: adds a "all" dependency of this object to the current derivator, does nothing if target is not tracked or if no derivator is currently running
         */
        use(target: object): void;
        prototype: Object;
    };
    /** **Summary**: an array that is tracked, changes to it can be noticed by derivations that use it
     *
     * you can inherit from this to allow your custom classes to have their properties tracked (custom classes are not tracked by default, see {@link State.track})
     *
     * you can use `instanceof State.Array` to test if an array is tracked, `instanceof State.Object` also returns true for tracked arrays
     *
     * **Reference**: creates a new array with the correct prototype and already wrapped in a proxy
     */
    Array: {
        new <T = any>(arrayLength?: number): T[];
        <T = any>(arrayLength?: number): T[];
        /** **Summary**: use the entire array, the current derivator will rerun if anything in the array changes
         *
         * this can be used as an optimization to avoid adding dependencies on each and every item individually by using `Derived.now` while still being correct
         *
         * **Reference**: adds a "all" dependency of this array to the current derivator, does nothing if target is not tracked or if no derivator is currently running
         */
        use(target: unknown[]): void;
        readonly prototype: any[];
    };
    /** **Summary**: a map that is tracked, changes to it can be noticed by derivations that use it
     *
     * you can inherit from this to allow your custom map classes to have their values tracked (custom classes are not tracked by default, see {@link State.track})
     *
     * you can use `instanceof State.Map` to test if a map is tracked, `instanceof State.Object` also returns true for tracked maps
     *
     * **Reference**: creates a new map with the correct prototype
     */
    Map: {
        new <K, V>(iterable?: Iterable<readonly [K, V]> | null | undefined): Map<K, V>;
        /** **Summary**: use the entire map, the current derivator will rerun if anything in the map changes
         *
         * this can be used as an optimization to avoid adding dependencies on each and every item individually by using `Derived.now` while still being correct
         *
         * **Reference**: adds a "all" dependency of this map to the current derivator, does nothing if target is not tracked or if no derivator is currently running
         */
        use(target: Map<unknown, unknown>): void;
        readonly prototype: Map<any, any>;
    };
    /** **Summary**: a set that is tracked, changes to it can be noticed by derivations that use it
     *
     * you can inherit from this to allow your custom set classes to have their values tracked (custom classes are not tracked by default, see {@link State.track})
     *
     * you can use `instanceof State.Set` to test if an object is tracked, `instanceof State.Object` also returns true for tracked sets
     *
     * **Reference**: creates a new set with the correct prototype
     */
    Set: {
        new <T>(iterable?: Iterable<T> | null | undefined): Set<T>;
        /** **Summary**: use the entire set, the current derivator will rerun if anything in the set changes
         *
         * this can be used as an optimization to avoid adding dependencies on each and every item individually by using `Derived.now` while still being correct
         *
         * **Reference**: adds a "all" dependency of this set to the current derivator, does nothing if target is not tracked or if no derivator is currently running
         */
        use(target: Set<unknown>): void;
        readonly prototype: Set<any>;
    };
};
export namespace State {
    /** **Summary**: a type alias to define that you expect a State of `T` for you to mutate, but that an immutable `T` or a derivation that returns a `T` is also fine
     *
     * this could be used for example as the value attribute of an input,
     *
     * use this to express that somewhere accepts derived but also accepts just the plain values for convenience
     *
     * interfaces that use this alias can check if the value is an instance of State to perform mutations on it
     *
     * this type has the semantics of possibly mutating the value if a State is passed
     *
     * although do note that it accepts the exact same values as `Derived.Or`, because `State` is a subtype of `Derived`
     */
    type Or<T> = T | Derived<T> | State<T>;
}

/** **Summary**: do something on affected objects when the dependencies changes (not lazy)
 *
 * the arguments consist of the objects you will affect, and the affector function at the end, at least one affected object must be specified
 *
 * not specifying an affected object may lead to the effector stopping prematurely due to being garbage collected
 *
 * specifying an affected object that is not affected may lead to the effector overstaying its welcome, and sticking around unexpectedly
 *
 * you can also call {@link Effect.Persistent} to create an effect that may affect everything, so it will affect forever or until its the clear method is called
 *
 * or you can  call {@link Effect.Weak} to create an effect object that has no references to itself, making it your responsibility to ensure it does not get garbage collected
 *
 * note that affected is not the dependencies to the affector, but rather, the objects that are affected by your function
 *
 * for example, if you intend update a text node on the dom with new values whenever some derived changes, the text node is the object you must pass as the affected
 *
 * ```
 * const text = new State("some text");
 * const node = document.createTextNode("");
 * new Effect(node, () => {
 *     node.nodeValue = text();
 * });
 * ```
 * 
 * another example, if you intend to log something to the console, and thus you want the affect to last forever, you could pass `console.log` or `console` as the affected, these would cause the effect to live forever
 *
 * ```
 * const text = new State("some text");
 * new Effect(console.log, () => {
 *     console.log("text changed: ", text());
 * });
 * ```
 *
 * not calling the clear method on the effect is **not** a memory leak (unless it is a persistent effect)
 *
 * because not adding references will likely cause the affect to be prematurely stopped, in order to create one without them you must specify it explicitly with `Effect.Weak` since for most cases that is not what you want and would simply be bug
 *
 * the fact the affector can be garbage collected is a feature meant to avoid the need to necessarily call clear on it, if everything it could affect is gone then it is safe to discard it
 *
 * if you did not setup the references correctly the affector may be prematurely garbage collected, causing some very hard to find bugs
 *
 * for that {@link Derived.debugLogWeakRefCleanUp} exists, however it could be improved
 *
 * **Reference**:
 *
 * the affector won't be called if the effect object is garbage collected
 *
 * the dependencies of the affector do not keep strong references to it
 *
 * the normal effect (not Persistent or Weak) creates strong references from the affected objects to itself, ensuring the effect can't be garbage collected before then
 *
 * the effect object won't be garbage collected until the affected can also be garbage collected
 *
 * the constructor schedules a task for the affector to run asynchronously, and schedules a task again when the dependencies change (you can force it complete synchronously with a call to run)
 *
 * the affector will keep on affecting until the affector object is garbage collected or it is cleared with the clear method
 *
 * the task scheduled is a microtask, it runs on the same loop and with the same priority as promises
 *
 * do not rely on the garbage collector for the correctness of your program, rely on it only to clear up things you no longer need, if you need the affector to stop, find a way to call the `clear` method at the appropriate time
 */
export interface Effect {
    /** **Summary**: stops this affector from being called, if a task is pending, it will be called synchronously
     *
     * further calls to other methods will do nothing
     */
    clear(): void;
    /** **Summary**: schedules this affector to be executed in a microtask
     *
     * does nothing if the affector was already cleared
     */
    trigger(): void;
    /** **Summary**: runs the affector synchronously, if a task was pending, it is cancelled
     *
     * does nothing if the affector was already cleared
     */
    run(): void;
    /** true if this affector has not yet been cleared */
    readonly active: boolean;
    /** the name specified when creating this object */
    readonly name: string;
}
export const Effect: {
    new(affected: WeakKey, affector: (affector: Effect) => void): Effect;
    new(...args: [WeakKey, ...WeakKey[], (affector: Effect) => void]): Effect;
    new(name: string, affected: WeakKey, affector: (affector: Effect) => void): Effect;
    new(name: string, ...args: [WeakKey, ...WeakKey[], (affector: Effect) => void]): Effect;
    prototype: Effect;

    /** **Summary**: creates an affector that may affect anything, not calling clear on this **is** a memory leak
     *
     * see the constructor for more information
     */
    Persistent: {
        new(affector: (affector: Effect) => void): Effect;
        new(name: string, affector: (affector: Effect) => void): Effect;
    };

    /** **Summary**: creates an affector that may be garbage collected, making it your responsibility to ensure it does not get garbage collected
     *
     * see the constructor for more information
     */
    Weak: {
        new(affector: (affector: Effect) => void): Effect;
        new(name: string, affector: (affector: Effect) => void): Effect;
    };
};

/** **Summary**: a function that when called, calls all the handlers
 *
 * its purpose is to be a function that can be declared first, and defined later
 *
 * it is like a reverse callback, instead of passing the callback so someone can call you,
 * you pass a signal so you can call them
 *
 * adding persistent handlers may lead to unwanted strong references and memory leaks,
 * so signals have the same mechanism of having the handlers list out the things they affect,
 * and allowing them to be garbage collected only after the affected
 *
 * **Reference**: when it is called it calls all handlers, forwarding the arguments and the this object, the handlers are called in the order they are added
 */
export type Signal<T extends (...args: any[]) => void> = Signal.Handler<T> & Signal.Prototype<T>;

export const Signal: {
    new <T extends (...args: any[]) => void>(): Signal<T>;
    prototype: Signal<any>;
};
export namespace Signal {
    /** **Summary**: the function that a `Signal<T>` accepts as handler, the `Signal<T>` also has the same call signature as its handlers
     *
     * **Reference**: the same function as T, except that it returns void */
    type Handler<T extends (...args: any[]) => void> =
        T extends (this: infer This, ...args: any[]) => void
        ? (this: This, ...args: T extends (...args: infer Args) => void ? Args : []) => void
        : (...args: T extends (...args: infer Args) => void ? Args : []) => void;
    /** **Summary**: the methods found in signals
     *
     * **Reference**: due to how typescript works, interfaces can't extend `Signal.Handler`, so `Signal` is a type alias and the interface is found here, so it can still be extended if necessary */
    interface Prototype<T extends (...args: any[]) => void> {
        /** adds a handler that will stop when garbage collected
         *
         * but that will not be garbage collected while the objects passed are alive (the affected)
         */
        on(...args: [WeakKey, ...WeakKey[], Signal.Handler<T>]): this;
        /** stops a handler from being called, works on handler added with both the `on` and `weak` methods */
        off(handler: Signal.Handler<T>): this;
        /** adds a handler that will only stop being called when it is removed with the off method */
        persistent(handler: Signal.Handler<T>): this;
        /** adds a handler that will stop when garbage collected */
        weak(handler: Signal.Handler<T>): this;
    }
}

declare global {
    interface Array<T> {
        /** creates a new mapped array, whose values are automatically kept up to date, by calling the function whenever dependencies change and are needed
         *
         * this is a special derived function that works with derived objects, and is not exactly equivalent to its non deriving counterpart
         *
         * attempting to mutate the resulting array directly will throw errors
         *
         * the resulting mapped array is lazy, it will only do work when values are read, because of the derivator is never called in the call to $map
         *
         * this call creates no dependencies on the current derivator
         *
         * the `$` indicates this is a method added by leviathan-state
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
         * it's that way because we can't look inside the promise to get its value synchronously, we can however add a handler to update a value we can read synchronously, and that is what we do
         *
         * however, because it notifies on change it is completely safe and correct to call this from derivations
         *
         * the `$` indicates this is a method added by leviathan-state
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
         * it's that way because we can't look inside the promise to get its value synchronously, we can however add a handler to update a value we can read synchronously, and that is what we do
         *
         * however, because it notifies on change it is completely safe and correct to call this from derivations
         *
         * the `$` indicates this is a method added by leviathan-state
         */
        $rejected(): this is { $value: undefined };
        /** returns true if this promise is already resolved or rejected
         *
         * calling this inside a derivation will cause the derivation to notice when the promise is settled
         *
         * note that the value returned is updated by the tracker of leviathan state and might not be true even if the promise is settled
         *
         * if the value is true that means the promise is settled, but if the value is false, that doesn't mean the promise isn't settled
         *
         * it's that way because we can't look inside the promise to get its value synchronously, we can however add a handler to update a value we can read synchronously, and that is what we do
         *
         * however, because it notifies on change it is completely safe and correct to call this from derivations
         *
         * the `$` indicates this is a method added by leviathan-state
         */
        $settled(): boolean;
        /** if the promise is resolved, returns its value
         *
         * if the promise is rejected, throws the error
         *
         * if the promise is not settled, returns undefined
         *
         * essentially its like an `await` except it returns synchronously if the promise is not settled
         *
         * the `$` indicates this is a method added by leviathan-state
         */
        $now(): this["$value"];
        /** returns the value, or undefined it this promise is not settled or was rejected
         *
         * using this inside a derivation will cause the derivation to notice when the promise is resolved
         *
         * note that this value is updated by the tracker of leviathan state and might not contain the value even if the promise is resolved
         *
         * if the value is here that means the promise is resolved, but if the value isn't here, that doesn't mean the promise isn't resolved
         *
         * however, because it notifies on change it is completely safe and correct to use this from derivations
         *
         * the `$` indicates this is a property added by leviathan-state
         */
        readonly $value: T | undefined;
        /** returns the error, or undefined it this promise is not settled or was resolved
         *
         * using this inside a derivation will cause the derivation to notice when the promise is rejected
         *
         * note that this value is updated by the tracker of leviathan state and might not contain the value even if the promise is rejected
         *
         * if the value is here that means the promise is rejected, but if the value isn't here, that doesn't mean the promise isn't rejected
         *
         * it's that way because we can't look inside the promise to get its value synchronously, we can however add a handler to update a value we can read synchronously, and that is what we do
         *
         * however, because it notifies on change it is completely safe and correct to use this from derivations
         *
         * the `$` indicates this is a property added by leviathan-state
         */
        readonly $error: unknown;
    }
}
