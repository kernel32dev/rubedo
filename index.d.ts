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
    derive<U>(derivator: (value: T) => U): Derived<Derived.Use<U>>;

    /** **Summary**: get a derived with the value of a property of the object stored
     *
     * `a.prop("b")` is equivalent to `a.derive(x => x["b"])`
     */
    prop<K extends keyof T>(key: K): Derived<Derived.Use<T[K]>>;

    /** **Summary**: shorthand for `this.derive(x => x ? truthy : falsy)` */
    choose<Truthy, Falsy>(truthy: Truthy, falsy: Falsy): Derived<Derived.Use<Truthy | Falsy>>;

    /** **Summary**: shorthand for `this.derive(x => x && then)` */
    and<Then>(then: Then): Derived<Derived.Use<Then | (T & (false | null | undefined | 0 | ""))>>;

    /** **Summary**: shorthand for `this.derive(x => x || else_)` */
    or<Else>(else_: Else): Derived<Derived.Use<Else | Exclude<T, (false | null | undefined | 0 | "")>>>;

    /** **Summary**: shorthand for `this.derive(x => x === null || x === undefined ? else_ : x)` */
    coalesce<Else>(else_: Else): Derived<Derived.Use<Else | (T & {})>>;

    /** **Summary**: like the derive method, but null and undefined are preserved, and not passed to the function provided
     *
     * shorthand for `this.derive(x => x === null || x === undefined ? x : fmap(x))` */
    fmap<U>(fmap: (value: T & {}) => U): Derived<Derived.Use<U | (T & (null | undefined))>>;

    /** the name specified when creating this object */
    readonly name: string;

    /** **Summary**: calls the `valueOf` method of the value inside, forwarding the arguments
     *
     * if the value is null or undefined, returns the value
     *
     * will throw if the method is not present
     *
     * **Reference**:
     *
     * calls `this`, if the resulting value is null or undefined returns the value,
     *
     * otherwise calls the `valueOf` method on the value, the return value is returned
     *
     * if the `valueOf` property is not present or not a function then a type error will be thrown
     */
    valueOf(): T extends { valueOf(): infer V; } ? V : never;

    /** **Summary**: calls the `toString` method of the value inside, forwarding the arguments
     *
     * if the value is null or undefined, returns them cast to string (does not throw on null or undefined)
     *
     * will throw if the method is not present
     *
     * **Reference**:
     *
     * calls `this`, if the resulting value is null or undefined returns them cast to string,
     *
     * otherwise calls the `toString` method on the value forwarding the arguments, the return value is converted to a string and returned
     *
     * if the `toString` property is not present or not a function then a type error will be thrown
     */
    toString(...args: T extends { toString(...args: infer U): any } ? U : []): string;

    /** **Summary**: calls the `toLocaleString` method of the value inside, forwarding the arguments
     *
     * if the value is null or undefined, returns them cast to string (does not throw on null or undefined)
     *
     * will throw if the method is not present
     *
     * **Reference**:
     *
     * calls `this`, if the resulting value is null or undefined returns them cast to string,
     *
     * otherwise calls the `toLocaleString` method on the value forwarding the arguments, the return value is converted to a string and returned
     *
     * if the `toLocaleString` property is not present or not a function then a type error will be thrown
     */
    toLocaleString(...args: T extends { toLocaleString(...args: infer U): any } ? U : []): string;

    /** **Summary**: allows you to pass derivations to `JSON.stringify`
     *
     * **Reference**: calls `this` and returns it, but if the resulting value as a function property `toJSON` it is called and the return value is returned instead */
    toJSON(): T extends { toJSON(): infer U } ? U : T;

    [Symbol.asyncIterator](): T extends { [Symbol.asyncIterator](): infer U } ? U : undefined;
    [Symbol.iterator](): T extends { [Symbol.iterator](): infer U } ? U : undefined;
}
export const Derived: Derived.Constructor;
export namespace Derived {
    interface Constructor {
        new <T>(derivator: () => T): Derived<Derived.Use<T>>;
        new <T>(name: string, derivator: () => T): Derived<Derived.Use<T>>;
        prototype: Derived<any>,

        /** **Summary**: runs a block of code without creating dependencies
         *
         * this is useful when you have a block of code somewhere that tracks dependencies such as inside an affector
         *
         * but that code is only meant to run in response to something and therefore not actually meant to create the dependencies
         */
        now<T>(derivator: () => T): Derived.Use<T>;

        /** **Summary**: turns values that may or may not be wrapped in Derived into always wrapped in Derived
         *
         * useful to work with `T | Derived<T>` or `Derived.Or<T>` types
         *
         * **Reference**: if you pass an instance of `Derived`, return it, otherwise, wrap it in a `Derived` that will never change
         */
        from<T>(value: T): Derived<Derived.Use<T>>;

        /** **Summary**: turns values that may or may not be wrapped in Derived into always plain values
         *
         * useful to work with `T | Derived<T>` or `Derived.Or<T>` types
         *
         * **Reference**: while value is an instance of `Derived`, calls it, then returns value
         */
        use<T>(value: T): Derived.Use<T>;

        /** **Summary**: creates a derived that gives a view into a property of an object
         *
         * useful for passing a property where a derived is expected
         *
         * **Reference**: returns a new cheap derivation that when called gets the specified key from the target
         */
        prop<T extends object, K extends keyof T>(target: T, key: K): Derived<Derived.Use<T[K]>>;
        prop<T extends object, K extends keyof T>(name: string, target: T, key: K): Derived<Derived.Use<T[K]>>;

        /** **Summary**: creates a derived without memoization
         *
         * as the name suggests this is for times when the derivator is cheap to run, and memoization would just be wasting time and memory
         *
         * if also makes sense to use cheap when the memoization would never do anything, such as when the derivation always creates a new (non frozen) object, in these cases disabling memoization also makes sense
         *
         * note that this does not mean that dependencies won't be added, this just means that they won't be added to this derivation in particular, but to the surrounding derivation instead
         *
         * **Reference**: creates an instance of derived that when called, calls derivator and passes it through `Derived.use` before returning the value
         *
         * note also that this is not exactly equivalent to a regular derivation, since dependencies are not tracked, derivator won't rerun if it invalidated it owns dependencies
         *
         * most of the time this won't be an issue since usually the derivator will be running inside a regular derivation or inside an effect that will rerun when that happens
         */
        cheap<T>(derivator: () => T): Derived<Derived.Use<T>>;
        cheap<T>(name: string, derivator: () => T): Derived<Derived.Use<T>>;

        /** **Summary**: A derived array is an array where its values are not stored in the array but rather somewhere else
         *
         * when the values of a derived are read, it runs code to derive it from somewhere else, possibly with memoization, no state (other than caching) is stored on derived arrays
         *
         * because of this they are naturally read-only, possibly not immutable, because wherever they are reading their data could change, but they can never be mutated directly
         *
         * derived arrays cannot be constructed directly, see `Derived.Array.proxy` or `Derived.Array.range` for examples
         */
        Array: {
            new(...args: never): never;
            /** **Summary**: creates a read-only derived array, whose values are derived from handler functions every time they are read
             *
             * the handler object must have the following methods:
             *
             * - **length** - returns the length of the array
             * - **item** - returns the value of the item at the specified index or `Derived.Array.empty` to indicate an empty slot
             * - **has** - (optional) returns true if the index is present, by default calls item and checks if it returned `Derived.Array.empty`
             * - **symbol** - (optional) returns the symbol that represents the slot, or undefined if the specified index is after the end of the array
             * - **symbols** - (optional) returns all the symbol that represents the slots as of currently, used to avoid having to call symbol in a loop when all symbols are needed
             * - **use** - (optional) use the entire array, "use" as in add a dependency of the current derivator to the entire array
             *
             * if `symbol` is implemented, then symbols may passed as the index to `item` and `has`, essentially, symbols represent the slot itself as it is shifted around the derived array
             *
             * this gives consumers a way to track the slots of an array accross mutations
             *
             * for example if you have an array of length 1 where the first item returns a particular symbol,
             * if an item were inserted at the beggining, making the first item now the second item, it should still return that particular symbol,
             * if the now second item were removed, then the methods `item` and `has` with the symbol should report that is does not exist (by returning `Derived.Array.empty` and false respectively)
             *
             * if you don't implement `symbol`, then `item` and `has` will never be called with a symbol for the index
             */
            proxy<T, H extends Derived.Array.ProxyHandlerWithoutSymbol<T>>(target: T, handler: H): Exclude<ReturnType<H["item"]>, typeof Derived.Array.empty>[];
            proxy<T, H extends Derived.Array.ProxyHandler<T>>(target: T, handler: H): Exclude<ReturnType<H["item"]>, typeof Derived.Array.empty>[];

            /** **Summary**: creates a derived array from a range from 0 up to the specified length exclusive, optionally transformed with a function first, and with the length possibly being derived from somewhere else
             *
             * this allows you to do the equivalent of a for loop in derivations
             *
             * the function is executed within a derivation so its safe to depend on data, and expect the resulting array to update automatically
             *
             * that also means that calls to fn are memoized and lazy, rerunning only when the value is requested and if dependencies changed
             */
            range<T>(length: Derived.Or<number>, fn: (index: number) => T): Derived.Use<T>[];
            range(length: Derived.Or<number>): number[];

            /** **Summary**: A symbol that represents the absence of an array item, expected to be returned on the `Derived.Array.ProxyHandler.item` when getting items past the array's end or at holes (sparse arrays) */
            readonly empty: unique symbol;
        };
        /** **TODO!** */
        Date: {
            new (...args: never): never;
            readonly prototype: Date;

            /** **Summary**: creates a read-only derived date, whose value is derived from a handler function every time it is read */
            proxy(handler: () => number): Date;

            /** **Summary**: returns an observable Date object that changes with the current time
            *
            * you can specify the precision of the date, time information less than the precision requested will be truncated to zero
            *
            * timezone specifies from what timezone to get the time, this is relevant for lower precisions such as hour and day, where the timezones affect where the day and hour boundaries are
            *
            * the only timezones supported are local and utc
            *
            * the frame argument specifies if the clock should update even if the browser does not want to render
            *
            * if it is set to `"respect frame"`, the clock will first call `requestAnimationFrame` to see if it makes sense to invalidate itself
            *
            * the default precision is second, the default timezone is local, and by default frames are respected if `requestAnimationFrame` is available
            */
            clock(
                precision?: "ms" | "second" | "minute" | "hour" | "day" = "sec",
                timezone?: "local" | "utc" = "local",
                frame?: "respect frame" | "ignore frame",
            ): Date;

            /** returns true if the date is in the past, if it is in the future and this method is executed inside a derivation, the derivation will be invalidated when this date passes */
            isPast(value: number | string | Date): boolean;
            /** returns true if the date is in the future, if it is in the future and this method is executed inside a derivation, the derivation will be invalidated when this date passes */
            isFuture(value: number | string | Date): boolean;
        };

        /** set this property to a function to log when any `WeakRef` created by rubedo is garbage collected */
        debugLogWeakRefCleanUp: ((message: string) => void) | null;

        /** what to do when a derivation or state is used outside a derivation, default is `allow`
         *
         * uses inside of `Derived.now` and calls to the `now` method are always allowed, even though they avoid creating dependencies
         */
        onUseDerivedOutsideOfDerivation: "allow" | "throw" | ((message: string) => void);

        /** what to do when a tracked object is used outside a derivation, default is `allow`
         *
         * uses inside of `Derived.now` are always allowed, even though they avoid creating dependencies
         */
        onUseTrackedOutsideOfDerivation: "allow" | "throw" | ((message: string) => void);
    }

    /** **Summary**: a type alias to define that you expect some `T` or a derivation that returns a `T`
     *
     * use this to express that somewhere accepts derived but also accepts just the plain values for convenience
     *
     * interfaces that use this alias should **not** check if the value is an instance of State to perform mutations on it
     *
     * this type alias has the semantics of not mutating the value
     *
     * although do note that it accepts the exact same values as `Derived.Or`, because `State` is a subtype of `Derived`
     *
     * is is safe to pass a `Derived` to Or, in which case it won't do anything
     */
    type Or<T> = T | Derived<Derived.Use<T>>;

    /** **Summary**: a recursive type alias to help you turn `T`, `Derived<T>` or `Derived<Derived<T>>` into `T` */
    type Use<T> = T extends Derived<infer U> ? Use<U> : T;

    type Array<T> = globalThis.Array<T>;
    namespace Array {
        /** **Summary**: inteface used to create derived arrays - see `Derived.Array.proxy` for more information */
        interface ProxyHandlerWithoutSymbol<T> {
            length(this: ProxyHandlerWithoutSymbol<T>, target: T): number;
            item(this: ProxyHandlerWithoutSymbol<T>, target: T, index: number): unknown | typeof Derived.Array.empty;
            has?(this: ProxyHandlerWithoutSymbol<T>, target: T, index: number): boolean;
            use?(this: ProxyHandlerWithoutSymbol<T>, target: T): void;
        }
        /** **Summary**: inteface used to create derived arrays - see `Derived.Array.proxy` for more information */
        interface ProxyHandler<T> {
            length(this: ProxyHandler<T>, target: T): number;
            item(this: ProxyHandler<T>, target: T, index: number | symbol): unknown | typeof Derived.Array.empty;
            has?(this: ProxyHandler<T>, target: T, index: number | symbol): boolean;
            symbol(this: ProxyHandler<T>, target: T, index: number): symbol | undefined;
            symbols(this: ProxyHandler<T>, target: T): symbol[];
            use?(this: ProxyHandler<T>, target: T): void;
        }
    }
}

/** **Summary**: hold a single mutable value
 *
 * this is the canonical way to represent a single value that can change, because rubedo can't track changes to local variables created with `let` and `var`
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
 * but let's say you that you this object to maybe be null, you can't just put it in a `let` since rubedo won't be able to track it, so instead you could use an instance of the `State` class
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
     * **Reference**: if the new value is different from the current one according to {@link State.is} equality, then it does nothing, otherwise it sets the value and invalidates dependents (not transitive invalidation)
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
export const State: State.Constructor;
export namespace State {
    interface Constructor {
        new <T>(value: T): State<T>;
        new <T>(name: string, value: T): State<T>;
        prototype: State<any>;

        /** **Summary**: adds tracking to an object so rubedo can notice when it is read and written to
         *
         * rubedo can create dependency trees and update graphs without a compiler, but without a dedicated compilation step, it may need to give it a hand so it can do its job
         *
         * if something is not tracked, it means rubedo won't be able to rerun derivations when that thing changes, this can be the cause of very subtle bugs
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
         * 9. **Date** (with default prototype, only the time stored)
         *
         * also note that some tracking requires wrapping the object in a proxy,
         * and thus the original value may not tracked,
         * this means references created before the call to track may be used to mutate the object without rubedo noticing
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
         * frozen objects have special handling when being compared in rubedo
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
         * has the semantics of `Object.is`, but frozen objects (`Object.isFrozen`) with the same string keyed properties and the same prototype are compared equal
         *
         * symbol keyed properties, property order and property enumerability are ignored
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
         * prop allows you to create a state that when read, it reads from your property, and when it is written to, it writes to your property
         *
         * allowing you to pass properties "by reference"
         *
         * ```
         * const username_input = create_input(State.prop(my_state, "username")); // correct, passing it "by reference"
         * ```
         *
         * **Reference**: creates a State object that when called reads the property,
         * calls to the set method sets the property,
         * and calls to mut, reads the property inside of `Derived.now` and the new value sets the property
         */
        prop<T extends object, K extends keyof T>(target: T, key: K): State<T[K]>;
        prop<T extends object, K extends keyof T>(name: string, target: T, key: K): State<T[K]>;

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
         * **Reference**: creates a new object with the correct prototype and properties and already wrapped in a proxy
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
            readonly prototype: Object;
            /** does the same as `Object.fromEntries`, but the created object is tracked and wrapped in a proxy */
            fromEntries<T = any>(entries: Iterable<readonly [PropertyKey, T]>): { [k: string]: T; };
            /** does the same as `Object.fromEntries`, but the created object is tracked and wrapped in a proxy */
            fromEntries(entries: Iterable<readonly any[]>): any;
            /** does the same as `Object.create`, but the created object is tracked and wrapped in a proxy */
            create(o: object | null): any;
            /** does the same as `Object.create`, but the created object is tracked and wrapped in a proxy */
            create(o: object | null, properties: PropertyDescriptorMap & ThisType<any>): any;
            /** does the same as `Object.groupBy`, but the created object is tracked and wrapped in a proxy */
            groupBy<K extends PropertyKey, T>(
                items: Iterable<T>,
                keySelector: (item: T, index: number) => K,
            ): Partial<Record<K, T[]>>;
        };
        /** **Summary**: an array that is tracked, changes to it can be noticed by derivations that use it
         *
         * you can inherit from this to allow your custom classes to have their properties tracked (custom classes are not tracked by default, see {@link State.track})
         *
         * you can use `instanceof State.Array` to test if an array is tracked, `instanceof State.Object` also returns true for tracked arrays
         *
         * **Reference**: creates a new array with the correct prototype and properties and already wrapped in a proxy
         */
        Array: {
            new(arrayLength?: number): any[];
            new <T>(arrayLength: number): T[];
            new <T>(...items: T[]): T[];
            (arrayLength?: number): any[];
            <T>(arrayLength: number): T[];
            <T>(...items: T[]): T[];
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
            /** does the same as `Array.from`, but the created array is tracked and wrapped in a proxy */
            from<T>(iterable: Iterable<T> | ArrayLike<T>): T[];
            /** does the same as `Array.from`, but the created array is tracked and wrapped in a proxy */
            from<T, U>(iterable: Iterable<T> | ArrayLike<T>, mapfn: (v: T, k: number) => U, thisArg?: any): U[];
            /** does the same as `Array.of`, but the created array is tracked and wrapped in a proxy */
            of<T>(...items: T[]): T[];
        };
        /** **Summary**: a map that is tracked, changes to it can be noticed by derivations that use it
         *
         * you can inherit from this to allow your custom map classes to have their values tracked (custom classes are not tracked by default, see {@link State.track})
         *
         * you can use `instanceof State.Map` to test if a map is tracked, `instanceof State.Object` also returns true for tracked maps
         *
         * **Reference**: creates a new map with the correct prototype and properties
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
         * **Reference**: creates a new set with the correct prototype and properties
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
        /** **Summary**: a promise that is tracked, its resolution and rejection can be noticed by derivations that use it
         *
         * you can inherit from this to allow your custom promise classes to be created already tracked (custom classes are not tracked by default, see {@link State.track})
         *
         * you can use `instanceof State.Promise` to test if an object is tracked, `instanceof State.Object` also returns true for tracked promises
         *
         * **Reference**: creates a new promise with the correct prototype and properties
         */
        Promise: {
            new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void): Promise<T>;
            /** **Summary**: use the entire promise, the current derivator will rerun if the promise resolves or rejects
             *
             * this has no real performance improvements over depending on resolution and rejection separately, this function is added mostly for completeness, although it does add tracking, but it should not be depended upon for this
             *
             * **Reference**: adds a dependency of the resolution and rejection of this promise to the current derivator, if target is not tracked then it adds tracking before adding the dependencies, does nothing if the promise is known to be resolved or if no derivator is currently running
             */
            use(target: Promise<unknown>): void;
            readonly prototype: Promise<any>;
            /** does the same as `Promise.all`, but the created promise is tracked, so the `$` methods and properties are immediatly correct */
            all<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>[]>;
            /** does the same as `Promise.race`, but the created promise is tracked, so the `$` methods and properties are immediatly correct */
            race<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>>;
            /** does the same as `Promise.all`, but the created promise is tracked, so the `$` methods and properties are immediatly correct */
            all<T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]>; }>;
            /** does the same as `Promise.race`, but the created promise is tracked, so the `$` methods and properties are immediatly correct */
            race<T extends readonly unknown[] | []>(values: T): Promise<Awaited<T[number]>>;
            /** does the same as `Promise.reject`, but the created promise is tracked, so the `$` methods and properties are immediatly correct */
            reject<T = never>(reason?: any): Promise<T>;
            /** does the same as `Promise.resolve`, but the created promise is tracked, so the `$` methods and properties are immediatly correct */
            resolve(): Promise<void>;
            /** does the same as `Promise.resolve`, but the created promise is tracked, so the `$` methods and properties are immediatly correct */
            resolve<T>(value: T): Promise<Awaited<T>>;
            /** does the same as `Promise.resolve`, but the created promise is tracked, so the `$` methods and properties are immediatly correct */
            resolve<T>(value: T | PromiseLike<T>): Promise<Awaited<T>>;
            /** does the same as `Promise.allSettled`, but the created promise is tracked, so the `$` methods and properties are immediatly correct */
            allSettled<T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: PromiseSettledResult<Awaited<T[P]>>; }>;
            /** does the same as `Promise.allSettled`, but the created promise is tracked, so the `$` methods and properties are immediatly correct */
            allSettled<T>(values: Iterable<T | PromiseLike<T>>): Promise<PromiseSettledResult<Awaited<T>>[]>;
            /** does the same as `Promise.any`, but the created promise is tracked, so the `$` methods and properties are immediatly correct */
            any<T extends readonly unknown[] | []>(values: T): Promise<Awaited<T[number]>>;
            /** does the same as `Promise.any`, but the created promise is tracked, so the `$` methods and properties are immediatly correct */
            any<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>>;
            /** does the same as `Promise.withResolvers`, but the created promise is tracked, so the `$` methods and properties are immediatly correct */
            withResolvers<T>(): {
                promise: Promise<T>;
                resolve: (value: T | PromiseLike<T>) => void;
                reject: (reason?: any) => void;
            };
        };
        /** **Summary**: a date that is tracked, changes to it can be noticed by derivations that use it
         *
         * you can inherit from this to allow your custom date classes to have their values tracked (custom classes are not tracked by default, see {@link State.track})
         *
         * you can use `instanceof State.Map` to test if a date is tracked, `instanceof State.Object` also returns true for tracked dates
         *
         * **Reference**: creates a new date with the correct prototype and properties
         */
        Date: {
            new (value: number | string | Date): Date;
            new (year: number, monthIndex: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): Date;
            new (): Date;
            readonly prototype: Date;
        };
    }
    type Object = globalThis.Object;
    type Array<T> = globalThis.Array<T>;
    type Map<K, V> = globalThis.Map<K, V>;
    type Set<T> = globalThis.Set<T>;
    type Promise<T> = globalThis.Promise<T>;
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
    /** **Summary**: check if this is the first time the affector is running
     *
     * useful to avoid performing side effects on the first execution
     *
     * but be careful not to also avoid creating the dependencies! if the effect doesn't call any derivations or states on the first call, it won't run again when those derivations change
     *
     * example:
     *
     * ```
     * const flag = new State(false);
     *
     * // incorrect, effect will never notice the flag changing
     * new Effect(console, effect => {
     *     if (effect.initializing) return;
     *     if (flag()) console.log("flag was set! (will never run)");
     * });
     *
     * // correct, dependencies are read, but effects are avoided on the first run
     * new Effect(console, effect => {
     *     if (flag()) {
     *         if (effect.initializing) return;
     *         console.log("flag was set!");
     *     }
     * });
     * ```
     *
     * **Reference**: true if the first call to the affector has not yet completed and is not cleared
     */
    readonly initializing: boolean;
    /** true if this affector has not yet been cleared */
    readonly active: boolean;
    /** the name specified when creating this object */
    readonly name: string;
}
export const Effect: Effect.Constructor;
export namespace Effect {
    interface Constructor {
        new(affected: WeakKey, affector: (effect: Effect) => void): Effect;
        new(...args: [WeakKey, ...WeakKey[], (effect: Effect) => void]): Effect;
        new(name: string, affected: WeakKey, affector: (effect: Effect) => void): Effect;
        new(name: string, ...args: [WeakKey, ...WeakKey[], (effect: Effect) => void]): Effect;
        prototype: Effect;

        /** **Summary**: creates an affector that may affect anything, not calling clear on this **is** a memory leak
         *
         * see the constructor for more information
         */
        Persistent: {
            new(affector: (effect: Effect) => void): Effect;
            new(name: string, affector: (effect: Effect) => void): Effect;
        };

        /** **Summary**: creates an affector that may be garbage collected, making it your responsibility to ensure it does not get garbage collected
         *
         * see the constructor for more information
         */
        Weak: {
            new(affector: (effect: Effect) => void): Effect;
            new(name: string, affector: (effect: Effect) => void): Effect;
        };
    }
}

/** **Summary**: a function that when called, calls all the handlers
 *
 * its purpose is to be a user level event,
 * like how `State` decouples data sources from data consumers,
 * `Signal` decouples event sources from event consumers
 *
 * adding persistent handlers may lead to unwanted strong references and memory leaks,
 * so signals have the same mechanism as effects, of having the handlers list out the things they affect,
 * and allowing them to be garbage collected only after the affected are garbage collected
 *
 * **Reference**: when it is called it calls all handlers, forwarding the arguments and the this object, the handlers are called in the order they are added
 *
 * the function succeeds if all handlers succeed, if one or more of them fail, the errors are collected into an aggregate error and thrown
 */
export interface Signal<in out T extends any[]> extends Signal.Sender<T>, Signal.Receiver<T> {}
export const Signal: Signal.Constructor;
export namespace Signal {
    interface Constructor {
        new <T extends any[] = []>(): Signal<T>;
        prototype: Signal<any[]>;

        /** **Summary**: the `/dev/null` of signals, you can add handlers to this and then call it, but nothing will happen
         *
         * suitable as a default value for signals
         *
         * only this instance of this kind of object exists, to test if a signal is null just compare it with this object
         */
        null: Signal<any>;
    }
    /** **Summary**: the sender half of a signal, which means just the signature of a function, is contravariant to T */
    interface Sender<in T extends any[]> {
        (...args: T): void;
    }
    /** **Summary**: the receiver half of a signal, contains all the methods for adding handlers and removing handlers to a signal, and is covariant to T */
    interface Receiver<out T extends any[]> {
        /** **Summary**: does the same as calling the signal, but returns errors instead of throwing them, always returns null on success and `AggregateError` otherwise */
        try(...args: T): AggregateError | null;
        /** **Summary**: adds a handler that will stop when garbage collected
         *
         * but that will not be garbage collected while the objects passed are alive (the affected)
         */
        on(...args: [WeakKey, ...WeakKey[], (...args: T) => void]): this;
        /** **Summary**: stops a handler from being called */
        off(handler: (...args: T) => void): this;
        /** **Summary**: adds a handler that will only stop being called when it is removed with the off method
         *
         * it is your responsiblity to ensure that either:
         * 1. you call the off method at some point
         * 2. the handler is meant to live for as long as the signal itself
         */
        persistent(handler: (...args: T) => void): this;
        /** **Summary**: adds a handler that will stop when garbage collected or when removed with the off method
         *
         * it is your responsiblity to ensure that someone has strong references to the handler, or else the handler may unexpectedly stop working because of garbage collection
         */
        weak(handler: (...args: T) => void): this;
    }
}

declare global {
    interface Array<T> {
        /** gets the symbol that represents this slot, returns undefined if the index is out of range or if slots are not tracked with symbols
         *
         * the `$` indicates this is a method added by rubedo
         */
        $slot(index: number): symbol | undefined;
        /** returns all the symbol that represents the slots as of currently, use this instead of calling symbol in a loop when all symbols are needed
         *
         * the `$` indicates this is a method added by rubedo
         */
        $slots(): (symbol | undefined)[];
        /** gets an item by symbol returns `Derived.Array.empty` if no slot is being tracked with that symbol
         *
         * the `$` indicates this is a method added by rubedo
         */
        $slotValue(index: symbol): T | typeof Derived.Array.empty;
        /** returns true if a slot is being tracked with that symbol
         *
         * the `$` indicates this is a method added by rubedo
         */
        $slotExists(index: symbol): boolean;
        /** uses this entire array, adding it in its entirety as a dependency of the current derivator
         *
         * the `$` indicates this is a method added by rubedo
         */
        $use(): void;

        /** TODO! update this documentation
         *
         * creates a new mapped array, whose values are automatically kept up to date, by calling the function whenever dependencies change and are needed
         *
         * this is a special derived function that works with derived objects, and is not exactly equivalent to its non deriving counterpart
         *
         * attempting to mutate the resulting array directly will throw errors
         *
         * the resulting mapped array is lazy, it will only do work when values are read, because of the derivator is never called in the call to $map
         *
         * this call creates no dependencies on the current derivator
         *
         * the `$` indicates this is a method added by rubedo
         */
        $map<U>(derivator: (value: T) => U): U[];
        $map<U, This>(derivator: (this: This, value: T) => U, thisArg: This): U[];
    }
    interface Promise<T> {
        /** returns true if this promise is already resolved (has `$value`)
         *
         * calling this inside a derivation will cause the derivation to notice when the promise is resolved
         *
         * note that the value returned is updated by the tracker of rubedo state and might not be true even if the promise is resolved
         *
         * if the value is true that means the promise is resolved, but if the value is false, that doesn't mean the promise isn't resolved
         *
         * it's that way because we can't look inside the promise to get its value synchronously, we can however add a handler to update a value we can read synchronously, and that is what we do
         *
         * however, because it notifies on change it is completely safe and correct to call this from derivations
         *
         * the `$` indicates this is a method added by rubedo
         */
        $resolved(): this is { $value: T };
        /** returns true if this promise is already rejected (has `$error`)
         *
         * calling this inside a derivation will cause the derivation to notice when the promise is rejected
         *
         * note that the value returned is updated by the tracker of rubedo state and might not be true even if the promise is rejected
         *
         * if the value is true that means the promise is rejected, but if the value is false, that doesn't mean the promise isn't rejected
         *
         * it's that way because we can't look inside the promise to get its value synchronously, we can however add a handler to update a value we can read synchronously, and that is what we do
         *
         * however, because it notifies on change it is completely safe and correct to call this from derivations
         *
         * the `$` indicates this is a method added by rubedo
         */
        $rejected(): this is { $value: undefined };
        /** returns true if this promise is already resolved or rejected
         *
         * calling this inside a derivation will cause the derivation to notice when the promise is settled
         *
         * note that the value returned is updated by the tracker of rubedo state and might not be true even if the promise is settled
         *
         * if the value is true that means the promise is settled, but if the value is false, that doesn't mean the promise isn't settled
         *
         * it's that way because we can't look inside the promise to get its value synchronously, we can however add a handler to update a value we can read synchronously, and that is what we do
         *
         * however, because it notifies on change it is completely safe and correct to call this from derivations
         *
         * the `$` indicates this is a method added by rubedo
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
         * the `$` indicates this is a method added by rubedo
         */
        $now(): this["$value"];
        /** returns the value, or undefined it this promise is not settled or was rejected
         *
         * using this inside a derivation will cause the derivation to notice when the promise is resolved
         *
         * note that this value is updated by the tracker of rubedo state and might not contain the value even if the promise is resolved
         *
         * if the value is here that means the promise is resolved, but if the value isn't here, that doesn't mean the promise isn't resolved
         *
         * however, because it notifies on change it is completely safe and correct to use this from derivations
         *
         * the `$` indicates this is a property added by rubedo
         */
        readonly $value: T | undefined;
        /** returns the error, or undefined it this promise is not settled or was resolved
         *
         * using this inside a derivation will cause the derivation to notice when the promise is rejected
         *
         * note that this value is updated by the tracker of rubedo state and might not contain the value even if the promise is rejected
         *
         * if the value is here that means the promise is rejected, but if the value isn't here, that doesn't mean the promise isn't rejected
         *
         * it's that way because we can't look inside the promise to get its value synchronously, we can however add a handler to update a value we can read synchronously, and that is what we do
         *
         * however, because it notifies on change it is completely safe and correct to use this from derivations
         *
         * the `$` indicates this is a property added by rubedo
         */
        readonly $error: unknown;
    }
    interface Date {
        /** returns true if this date is in the past, if it is in the future and this method is executed inside a derivation, the derivation will be invalidated when this date passes
         *
         * the `$` indicates this is a property added by rubedo
         */
        $isPast(): boolean;
        /** returns true if this date is in the future, if it is in the future and this method is executed inside a derivation, the derivation will be invalidated when this date passes
         *
         * the `$` indicates this is a property added by rubedo
         */
        $isFuture(): boolean;
    }
}
