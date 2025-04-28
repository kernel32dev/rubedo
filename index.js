//@ts-nocheck
"use strict";

// TODO! replace creation of objects followed by `Object.setPrototypeOf` with `Reflect.construct`

// TODO! in arrays checking if the item exists often creates a full dependency on the value, fix that or state somewhere that this is not a problem

//#region symbols

// TODO! organize the symbols and don't share them unless necessary

/** the derivations of this object (Derived objects that depend on this), present on all objects that can be depended on such as State and Derived
 *
 * on `State`, `Derived` and `DerivedDate` this is always a `Set<WeakRef<Derived>>`
 *
 * on `StateObject` this is always a `Record<string | sym_all, Set<WeakRef<Derived>>>` with null prototype
 *
 * on `StateArray` this is always a `(Set<WeakRef<Derived>> | <empty>)[]` (each item represents the corresponding item in the real array by index, (shifting will invalidate later slots))
 *
 * on `StateMap` and `StateSet` this is always a `Map<any, Set<WeakRef<Derived>>>`
 *
 * the value is `WeakRef<Derived>` and if it matches `.deref()[sym_weak]` that means the derivation is still active
 *
 * if it does not match, this weakref can be discarded, since it was from an outdated derivation */
const sym_ders = Symbol("ders");

/** the slot based derivations of this array, present on all `StateArray`
 *
 * unlike sym_ders, shifting will **not** invalidate later slots
 *
 * will be used by deriving functions that do not rely on the position of the element
 */
const sym_ders_slots = Symbol("ders_slots");

/** the symbols that represent the identity of the slots in this array, present on all `StateArray` */
const sym_slots = Symbol("slots");

/** the derivations of the array's length, present on all `StateArray` */
const sym_len = Symbol("len");

/** the invalidated and possibly invalidated dependencies of this object, present only on Derived objects
 *
 * having a non empty set on this value means this Derived is possibly invalidated, it is possibly invalidated if any of the derives in this set are invalidated
 *
 * this is always a `Map<WeakRef<Derived>, any>`
 *
 * the key is `WeakRef<Derived>` unlike sym_ders, it does not matter if it matches `.deref()[sym_weak]`, the point here is just to have a weak reference to the dependent object
 *
 * the value refers to the value the derivation was last known as, because it may be reevaluated without our knowledge, so we must track it here, we can't track it on the remote derived
 *
 * it should safe to use a weak ref here, because if it is garbage collected, then it was not a dependency anyway
 *
 * when obtaining the value for this derivation, this map should always be checked, and any derivations found on it should be evaluated, taking care to not accidentally create dependencies
 *
 * if any of the derivation produce a different value from what was last seen, then the current derivation is invalidated
 *
 * if every derivation produce the expected value, then the current derivation is validated and up to date
 */
const sym_pideps = Symbol("pideps");

/** the current weak ref to this derived object, present only on Derived objects
 *
 * this is always a `WeakRef<Derived> | null`
 *
 * if this value is null this means this derived is invalidated and
 *
 * when this derive is invalidated
 *
 * when the new value is produced, a new WeakRef is always stored
 */
const sym_weak = Symbol("weak");

/** the permanent weak ref to this derived object, present only on Derived objects
 *
 * this is always a `WeakRef<Derived> | null`
 *
 * if this value is null it just means this property has not been initialized
 */
const sym_piweak = Symbol("piweak");

/** the value of this object, always exists on State, and exists on Derived unless it is being actively derived, has never being derived or is an affect
 *
 * also used by `StateArray` to store itself not wrapped in a proxy
 */
const sym_value = Symbol("value");

/** this symbol is present on active affector functions
 *
 * when those derivations are invalidated, a microtask is scheduled to automatically rerun the derivator
 *
 * the value is a `boolean | null | undefined`
 *
 * if it is true that mean the microtask is scheduled and the invalidation is transitive
 *
 * if it is false that mean the microtask is scheduled and the invalidation is not transitive
 *
 * if it is null that means the microtask is not scheduled
 *
 * if it is undefined that means the affector is cleared
 */
const sym_affect_task = Symbol("affect_task");

/** this symbol is present on active affector functions
 *
 * this contains a function that is not called whenever a dependency of the derivation possibly changes
 */
const sym_affect = Symbol("affect");

/** the set of references that are present in affectFunctionsWeakRefs */
const sym_affect_refs = Symbol("affect_refs");

/** a symbol present on tracked objects, the value is itself after tracking
 *
 * used to reobtain the proxy-ed version of an object to avoid unnecessary creation of duplicate proxies
 */
const sym_tracked = Symbol("tracked");

/** a symbol used by `StateObject[sym_ders]` when something depends on all string properties
 *
 * also used by `StateArray` to store derivations `Set<WeakRef<Derived>>` that need all values
 */
const sym_all = Symbol("all");

/** used by StateView and DerivedArray */
const sym_target = Symbol("target");

/** used by StateView and DerivedArray and DerivedDate */
const sym_handler = Symbol("handler");

/** used by StateView */
const sym_key = Symbol("key");

/** used by StateProxy */
const sym_getter = Symbol("getter");

/** used by StateProxy */
const sym_setter = Symbol("setter");

/** used by Promise */
const sym_resolved = Symbol("resolved");

/** used by Promise */
const sym_rejected = Symbol("rejected");

/** used by Promise */
const sym_ders_resolved = Symbol("ders_resolved");

/** used by Promise */
const sym_ders_rejected = Symbol("ders_rejected");

/** used by Signal */
const sym_handlers = Symbol("handlers");

/** used by Signal */
const sym_weakrefs = Symbol("weakrefs");

/** used by Derived.Array.Proxy.item to represent absence */
const sym_empty = Symbol("empty");

//#endregion
//#region globals

/** Derived
 * @typedef {{
 *     (): any,
 *     [sym_pideps]: Map<WeakRef<Derived>, any>,
 *     [sym_ders]: Set<WeakRef<Derived>>,
 *     [sym_weak]: WeakRef<Derived>,
 *     [sym_value]?: any,
 * }} Derived
 */

/** StateArray
 * @typedef {any[] & {
 *     [sym_ders]: Set<WeakRef<Derived>>[],
 *     [sym_ders_slots]: Set<WeakRef<Derived>>[],
 *     [sym_slots]: symbol[],
 *     [sym_len]: Set<WeakRef<Derived>>,
 *     [sym_all]: Set<WeakRef<Derived>>,
 *     [sym_value]: StateArray,
 *     [sym_tracked]: StateArray,
 * }} StateArray
 */

/** if this value is set, it is the weak ref of the derived currently running at the top of the stack
 *
 * if it is null, it means we are ignoring dependencies
 *
 * if it is undefined, it means we are outside a derived
 *
 * @type {WeakRef<Derived> | null | undefined} */
let current_derived = undefined;

/** flag that is set everytime the derivation is used
 *
 * used to turn a derivation with dependencies into a const derivator
 */
let current_derived_used = true;

/** this may be unnecessary because circular derivation is already being detected, but i could not prove this
 *
 * note that it is safe to use a WeakSet here because all values referenced in this set are on the stack
 */
const recursiveDerivationInvalidationGuard = new WeakSet();

/** a weak map of references that keep affector objects from being garbage collected
 *
 * @type {WeakMap<object | symbol, Set>} */
const affectFunctionsWeakRefs = new WeakMap();

/** a strong set of `Effect.Persistent` referenced that keep affect functions from being garbage collected
 *
 * @type {Set} */
const affectFunctionsRefs = new Set();

const NativeWeakRef = (globalThis).WeakRef;
let WeakRef = NativeWeakRef;
/** @type {FinalizationRegistry | null} */
let debugRegistry = null;
/** @type {((message: string) => void) | null} */
let debugWeakRefLogger = null;

/** how many times a derivator can repeat because it invalidated itself before giving up */
const maximumDerivedRepeats = 50;

/** how much Object.is can recurse before the recursion guard starts being used */
const maximumFrozenComparisonsDepth = 10;

/** the isr function can't detect recursion before this runs out */
let remainingFrozenComparisonsDepth = maximumFrozenComparisonsDepth;

/** the set of frozen objects being used in a State.is after all remainingFrozenComparisonsDepth were exhausted
 *
 * note that it is safe to use a WeakSet here because all values referenced in this set are on the stack
 *
 * TODO! change this to a WeakMap<object, WeakSet<object>> to properly track the pair of the comparison rather than just members
 */
const recursiveFrozenComparisonGuard = new WeakSet();

let current_scheduler_stack = "";

/** @type {(func: any, args: [any, ...any[]]) => any} */
const apply = Function.prototype.apply.bind(Function.prototype.apply);

//#endregion
//#region Derived

const DerivedPrototype = defineProperties({ __proto__: Function.prototype }, {
    constructor: Derived,
    now() {
        const old_derived = current_derived;
        const old_derived_used = current_derived_used;
        current_derived = null;
        try {
            return this();
        } finally {
            current_derived = old_derived;
            current_derived_used = old_derived_used;
        }
    },
    derive(derivator) {
        if (typeof derivator !== "function") throw new TypeError("argument is not a function");
        const derived = this;
        return new Derived({
            [derivator.name]() {
                return derivator(derived());
            }
        }[derivator.name]);
    },
    cheap(derivator) {
        if (typeof derivator !== "function") throw new TypeError("argument is not a function");
        const derived = this;
        return Derived.cheap({
            [derivator.name]() {
                return derivator(derived());
            }
        }[derivator.name]);
    },
    prop(key) {
        const derived = this;
        return new Derived(function prop() {
            return derived()[key];
        });
    },
    call() {
        const args = [null];
        args.push(...arguments);
        const derived = this;
        return new Derived(function call() {
            apply(derived(), args);
        });
    },
    callThis() {
        const args = arguments;
        const derived = this;
        return new Derived(function callThis() {
            apply(derived(), args);
        });
    },
    method() {
        const args = arguments;
        const methodName = args[0];
        const derived = this;
        return new Derived(function method() {
            const obj = derived();
            args[0] = obj;
            apply(obj[methodName], args);
        });
    },
    choose(truthy, falsy) {
        const derived = this;
        return new Derived(function choose() {
            return derived() ? truthy : falsy;
        });
    },
    and(then) {
        const derived = this;
        return new Derived(function and() {
            return derived() && then;
        });
    },
    or(else_) {
        const derived = this;
        return new Derived(function or() {
            return derived() || else_;
        });
    },
    eq(value) {
        const derived = this;
        return new Derived(
            value instanceof Derived
                ? function eq() {
                    return is(derived(), value());
                }
                : function eq() {
                    return is(derived(), value);
                }
        );
    },
    neq(value) {
        const derived = this;
        return new Derived(
            value instanceof Derived
                ? function neq() {
                    return !is(derived(), value());
                }
                : function neq() {
                    return !is(derived(), value);
                }
        );
    },
    not() {
        const derived = this;
        return new Derived(function not() {
            return !derived();
        });
    },
    bool() {
        const derived = this;
        return new Derived(function bool() {
            return !!derived();
        });
    },
    length() {
        const derived = this;
        return new Derived(function length() {
            return derived().length;
        });
    },
    coalesce(else_) {
        const derived = this;
        return new Derived(function coalesce() {
            const value = derived();
            return value === null || value === undefined ? else_ : value;
        });
    },
    fmap(fmap) {
        if (typeof fmap !== "function") throw new TypeError("argument is not a function");
        const derived = this;
        return new Derived({
            [fmap.name]() {
                const value = derived();
                return value === null || value === undefined ? value : fmap(value);
            }
        }[fmap.name]);
    },
    resolved() {
        const derived = this;
        return new Derived(function resolved() {
            return derived().$resolved();
        });
    },
    rejected() {
        const derived = this;
        return new Derived(function rejected() {
            return derived().$rejected();
        });
    },
    settled() {
        const derived = this;
        return new Derived(function settled() {
            return derived().$settled();
        });
    },
    pending() {
        const derived = this;
        return new Derived(function pending() {
            return !derived().$settled();
        });
    },
    then(onfulfilled, onrejected) {
        const derived = this;
        return new Derived(function then() {
            return track(derived().then(onfulfilled, onrejected));
        });
    },
    catch(onrejected) {
        const derived = this;
        return new Derived({
            catch() { return track(derived().catch(onrejected)); }
        }["catch"]);
    },
    valueOf() {
        const value = this();
        return value === null || value === undefined ? value : value.valueOf();
    },
    toString() {
        const value = this();
        return value === null ? "null" : value === undefined ? "undefined" : "" + value.toString.apply(value, arguments);
    },
    toLocaleString() {
        const value = this();
        return value === null ? "null" : value === undefined ? "undefined" : "" + value.toLocaleString.apply(value, arguments);
    },
    toJSON() {
        const value = this();
        if (value && typeof value.toJSON == "function") return value.toJSON();
        return value;
    },
});

Object.defineProperty(DerivedPrototype, Symbol.iterator, {
    get: {
        [Symbol.iterator]() {
            return Symbol.iterator in Object(this()) ? derivedIteratorMethod : undefined;
        }
    }[Symbol.iterator],
    enumerable: false,
    configurable: true,
});
Object.defineProperty(DerivedPrototype, Symbol.asyncIterator, {
    get: {
        [Symbol.asyncIterator]() {
            return Symbol.asyncIterator in Object(this()) ? derivedAsyncIteratorMethod : undefined;
        }
    }[Symbol.asyncIterator],
    enumerable: false,
    configurable: true,
});

function derivedIteratorMethod() {
    return this()[Symbol.iterator]();
}
function derivedAsyncIteratorMethod() {
    return this()[Symbol.asyncIterator]();
}

/** @param {Map<WeakRef<Derived>, any>} pideps @param {WeakRef<Derived>} [recreate_weak_link]   */
function possibleInvalidationIsInvalidated(pideps, recreate_weak_link) {
    if (pideps.size == 0) return false;
    const arr = Array.from(pideps.keys());
    const old_derived = current_derived;
    const old_derived_used = current_derived_used;
    current_derived = null; // this null ensures the true invalidation tests below don't add any derivations
    try {
        // this for finds all references in pideps that don't point to an invalidated derived, and stops as soon as it finds one
        for (let i = 0; i < arr.length; i++) {
            const weak = arr[i];
            const derived = weak.deref();
            if (!derived) {
                pideps.delete(weak);
                continue;
            }
            const old_value = pideps.get(weak);
            // TODO! somehow ensure this can't cause an infinite recursive loop
            const new_value = derived();
            if (!is(old_value, new_value)) return true;
        }
        // loop exited, no invalidations found, we are still valid
        // add myself as derivations for all dependencies, so that i and my derivations can still be notified to changes non lazily
        // this is only needed when revalidating due to an affect (not lazy), we do this only when one is involved
        if (recreate_weak_link) {
            for (let i = 0; i < arr.length; i++) {
                const weak = arr[i];
                const derived = weak.deref();
                if (!derived) continue;
                derived[sym_ders].add(recreate_weak_link);
            }
        }
        return false;
    } finally {
        current_derived = old_derived;
        current_derived_used = old_derived_used;
    }
}

function Derived(name, derivator) {
    if (!new.target) throw new TypeError("Constructor Derived requires 'new'");
    if (arguments.length == 1) {
        derivator = name;
        name = "Derived";
    }
    if (typeof derivator !== "function") throw new TypeError("Derivator is not a function");
    name = name === "Derived" ? derivator.name || name : ("" + name) || "Derived";
    /** @type {Derived} */
    const derived = ({
        [name]() {
            // derivator is set to null after the derivator executes without creating dependencies
            if (!derivator) {
                let value = derived[sym_value];
                while (value instanceof Derived) value = value();
                return value;
            }

            // add the current derivator as a derivation of myself
            if (current_derived) {
                derived[sym_ders].add(current_derived);
                current_derived_used = true;
            } else if (current_derived == undefined) {
                const penalty = Derived.onUseDerivedOutsideOfDerivation;
                const msg = derived.name + " used outside of derivation";
                if (penalty === "throw") throw new Error(msg);
                if (typeof penalty == "function") penalty(msg);
            }

            const old_weak = derived[sym_weak];
            if (old_weak) {
                if (!(sym_value in derived)) {
                    // TODO! add information to help pin down the loop
                    throw new RangeError("Circular dependency between derives detected");
                }
                // TODO! somehow ensure this can't cause an infinite recursive loop
                const pideps = derived[sym_pideps];
                // TODO! since recreating the sym_ders link is only needed when revalidating due to an affect (not lazy), do this only when one is involved
                // (referring to the second argument of the call below)
                if (!possibleInvalidationIsInvalidated(pideps, old_weak)) {
                    let value = derived[sym_value];
                    while (value instanceof Derived) {
                        value = value();
                        // TODO! maybe its necessary to recheck derived[sym_weak] or derived[sym_pideps] now that user code executed
                    }
                    return value;
                }
                pideps.clear();
            }
            const new_weak = new WeakRef(derived);
            const old_derived = current_derived;
            const old_derived_used = current_derived_used;
            // current_derived = new_weak;
            const old_value = derived[sym_value];
            try {
                delete derived[sym_value];
                for (let i = 0; i < maximumDerivedRepeats; i++) {
                    derived[sym_weak] = new_weak;
                    current_derived = new_weak;
                    current_derived_used = false;
                    const original_value = track(derivator());
                    let value = original_value;

                    const my_current_derived_used = current_derived_used;
                    current_derived = old_derived;
                    while (derived[sym_weak] && value instanceof Derived) {
                        value = value();
                    }
                    if (derived[sym_weak]) {
                        if (!my_current_derived_used) derivator = null;
                        derived[sym_value] = original_value;
                        return value;
                    }
                }
                throw new RangeError("Too many recursive derivation invalidations");
            } catch (e) {
                derived[sym_value] = old_value;
                derived[sym_weak] = old_weak;
                throw e;
            } finally {
                current_derived = old_derived;
                current_derived_used = old_derived_used;
            }
        }
    })[name];
    Object.setPrototypeOf(derived, new.target.prototype);
    Object.defineProperty(derived, sym_ders, { value: new Set() });
    Object.defineProperty(derived, sym_pideps, { value: new Map() });
    Object.defineProperty(derived, sym_weak, { writable: true, value: null });
    Object.defineProperty(derived, sym_piweak, { writable: true, value: null });
    return derived;
}

defineProperties(Derived, {
    now(derivator) {
        const old_derived = current_derived;
        const old_derived_used = current_derived_used;
        current_derived = null;
        try {
            let value = derivator();
            while (value instanceof Derived) value = value();
            return value;
        } finally {
            current_derived = old_derived;
            current_derived_used = old_derived_used;
        }
    },
    from(value) {
        if (value instanceof Derived) return value;
        value = track(value);
        return Object.setPrototypeOf(function Derived() { return value; }, DerivedPrototype);
    },
    use(value) {
        while (value instanceof Derived) value = value();
        return track(value);
    },
    prop(name, target, prop) {
        if (arguments.length == 2) {
            prop = target;
            target = name;
            name = "PropDerived";
        }
        if (typeof prop != "string" && typeof prop != "number" && typeof prop != "symbol") throw new TypeError("prop is not a string, number or symbol");
        if (typeof target !== "object" || !target) throw new TypeError("Derivator is not a function");
        name = name === "PropDerived" ? (typeof prop == "symbol" ? prop.description || "symbol" : "" + prop) || name : ("" + name) || "PropDerived";
        return Object.setPrototypeOf({
            [name]() {
                let value = target[prop];
                while (value instanceof Derived) value = value();
                return value;
            }
        }[name], DerivedPrototype);
    },
    cheap(name, derivator) {
        if (arguments.length == 1) {
            derivator = name;
            name = "CheapDerived";
        }
        if (typeof derivator !== "function") throw new TypeError("Derivator is not a function");
        name = name === "CheapDerived" ? derivator.name || name : ("" + name) || "CheapDerived";
        return Object.setPrototypeOf({
            [name]() {
                let value = derivator();
                while (value instanceof Derived) value = value();
                return value;
            }
        }[name], DerivedPrototype);
    },
    Array: DerivedArray,
    Date: DerivedDate,
    onUseDerivedOutsideOfDerivation: "allow",
    onUseTrackedOutsideOfDerivation: "allow",
});

Object.defineProperty(Derived, "debugLogWeakRefCleanUp", {
    get() {
        return debugWeakRefLogger;
    },
    set(logger) {
        if (logger === null) {
            debugWeakRefLogger = null;
            WeakRef = NativeWeakRef;
            if (debugRegistry) debugRegistry = null;
            return;
        }
        if (typeof logger != "function") throw new TypeError("logger is not a function");
        debugWeakRefLogger = logger;
        if (!debugRegistry) {
            const regex = new RegExp("^Error: ");
            debugRegistry = new FinalizationRegistry(stack => {
                const now = new Date();
                const h = ("0" + now.getHours()).slice(-2);
                const m = ("0" + now.getMinutes()).slice(-2);
                const s = ("0" + now.getSeconds()).slice(-2);
                const ms = ("00" + now.getMilliseconds()).slice(-3);
                debugWeakRefLogger(`${h}:${m}:${s}.${ms} ${("" + stack).replace(regex, "")}`);
            });
            WeakRef = function DebugWeakRef(target) {
                const ref = new NativeWeakRef(target);
                const e = Error("cleanup (type: " + typeof target + ") (name: " + target.name + ")");
                // const e = Error("cleanup (ref)");
                addSchedulerStack(e, current_scheduler_stack);
                debugRegistry.register(target, e.stack);
                return ref;
            }
        }
    },
});

Derived.prototype = DerivedPrototype;

//#endregion Derived
//#region State

const StatePrototype = defineProperties({ __proto__: DerivedPrototype }, {
    constructor: State,
    now() {
        let value = this[sym_value];
        if (!(value instanceof Derived)) return value;
        return Derived.now(function () {
            do {
                value = value();
            } while (value instanceof Derived);
            return value;
        });
    },
    nested() {
        if (current_derived) {
            this[sym_ders].add(current_derived);
            current_derived_used = true;
        } else if (current_derived == undefined) {
            const penalty = Derived.onUseDerivedOutsideOfDerivation;
            const msg = this.name + " used outside of derivation";
            if (penalty === "throw") throw new Error(msg);
            if (typeof penalty == "function") penalty(msg);
        }
        return this[sym_value];
    },
    nestedNow() {
        return this[sym_value];
    },
    set(value) {
        value = track(value);
        if (!is(this[sym_value], value)) {
            this[sym_value] = value;
            invalidateDerivationSet(this[sym_ders]);
        }
    },
    mut(transformer) {
        if (typeof transformer != "function") throw new TypeError("transformer is not a function");
        const self = this;
        Derived.now(function () {
            const value = track(transformer(self[sym_value]));
            if (!is(self[sym_value], value)) {
                self[sym_value] = value;
                invalidateDerivationSet(self[sym_ders]);
            }
        });
    },
});

const StateViewPrototype = defineProperties({ __proto__: StatePrototype }, {
    now() {
        const self = this;
        return Derived.now(function () {
            let value = self[sym_target][self[sym_key]];
            while (value instanceof Derived) value = value();
            return value;
        });
    },
    nested() {
        return this[sym_target][this[sym_key]];
    },
    nestedNow() {
        const self = this;
        return Derived.now(function () {
            return self[sym_target][self[sym_key]];
        });
    },
    set(value) {
        this[sym_target][this[sym_key]] = value;
    },
    mut(transformer) {
        const self = this;
        Derived.now(function () {
            const target = self[sym_target];
            const key = self[sym_key];
            target[key] = transformer(target[key]);
        });
    },
});

const StateProxyPrototype = defineProperties({ __proto__: StatePrototype }, {
    now() {
        const self = this;
        return Derived.now(function () {
            let value = self[sym_getter]();
            while (value instanceof Derived) value = value();
            return value;
        });
    },
    nested() {
        return this[sym_getter]();
    },
    nestedNow() {
        const self = this;
        return Derived.now(function () {
            return self[sym_getter]();
        });
    },
    set(value) {
        this[sym_setter](value);
    },
    mut(transformer) {
        const self = this;
        Derived.now(function () {
            self[sym_setter](transformer(self[sym_getter]()));
        });
    },
});

function State(name, value) {
    if (!new.target) throw new TypeError("Constructor State requires 'new'");
    if (arguments.length == 1) {
        value = name;
        name = "State";
    } else {
        name = ("" + name) || "State";
    }
    const State = ({
        [name]() {
            if (current_derived) {
                State[sym_ders].add(current_derived);
                current_derived_used = true;
            } else if (current_derived == undefined) {
                const penalty = Derived.onUseDerivedOutsideOfDerivation;
                const msg = State.name + " used outside of derivation";
                if (penalty === "throw") throw new Error(msg);
                if (typeof penalty == "function") penalty(msg);
            }
            let value = State[sym_value];
            while (value instanceof Derived) value = value();
            return value;
        }
    })[name];
    Object.setPrototypeOf(State, new.target.prototype);
    Object.defineProperty(State, sym_ders, { value: new Set() });
    State[sym_value] = track(value);
    return State;
}

defineProperties(State, {
    track,
    prop(name, target, key) {
        if (arguments.length == 2) {
            key = target;
            target = name;
            name = "StateView";
        } else {
            name = "" + name;
        }
        if (!target || (typeof target != "object" && typeof target != "function")) throw new TypeError("the target is not an object");
        if (typeof key != "string" && typeof key != "number" && typeof key != "symbol") throw new TypeError("State.prop can't use a value of type " + typeof key + " as a key");
        const State = ({
            [name]() {
                let value = State[sym_target][State[sym_key]];
                while (value instanceof Derived) value = value();
                return value;
            }
        })[name];
        Object.setPrototypeOf(State, StateViewPrototype);
        Object.defineProperty(State, sym_target, { value: track(target) });
        Object.defineProperty(State, sym_key, { value: key });
        return State;
    },
    proxy(name, getter, setter) {
        if (arguments.length == 2) {
            setter = getter;
            getter = name;
            name = "StateProxy";
        } else {
            name = "" + name;
        }
        if (typeof getter != "function") throw new TypeError("getter is not a function");
        if (typeof setter != "function") throw new TypeError("setter is not a function");
        const State = ({
            [name]() {
                let value = State[sym_getter]();
                while (value instanceof Derived) value = value();
                return value;
            }
        })[name];
        Object.setPrototypeOf(State, StateProxyPrototype);
        Object.defineProperty(State, sym_getter, { value: getter });
        Object.defineProperty(State, sym_setter, { value: setter });
        return State;
    },
    freeze,
    is,
    Object: StateObject,
    Array: StateArray,
    Map: StateMap,
    Set: StateSet,
    Promise: StatePromise,
    Date: StateDate,
})

State.prototype = StatePrototype;

function use_state(state) {
    if (current_derived) {
        state[sym_ders].add(current_derived);
        current_derived_used = true;
    } else if (current_derived == undefined) {
        const penalty = Derived.onUseDerivedOutsideOfDerivation;
        const msg = state.name + " used outside of derivation";
        if (penalty === "throw") throw new Error(msg);
        if (typeof penalty == "function") penalty(msg);
    }
}

//#endregion State
//#region Effect

// TODO! implement and document what trigger and run do when called from inside the affector

const AffectorPrototype = defineProperties({}, {
    constructor: Effect,
    clear() {
        const affect_task = this[sym_affect_task];
        if (affect_task === undefined) return;
        try {
            this[sym_affect]();
        } finally {
            if (this.initializing) Object.defineProperty(this, "initializing", { value: false });
            if (this[sym_affect_task] !== undefined) {
                this[sym_affect_task] = undefined;
                this[sym_pideps].clear();
                const refs = this[sym_affect_refs];
                if (refs) {
                    for (const i of refs) {
                        /** @type {Set | undefined} */
                        const set = affectFunctionsWeakRefs.get(i);
                        if (set && set.delete(this) && set.size == 0) {
                            affectFunctionsWeakRefs.delete(i);
                        }
                    }
                    refs.clear();
                } else {
                    affectFunctionsRefs.delete(this);
                }
            }
        }
    },
    trigger() {
        const affect_task = this[sym_affect_task];
        if (affect_task !== undefined) {
            this[sym_affect_task] = false;
            if (affect_task === null) queue(this[sym_affect]);
        }
    },
    run() {
        if (this[sym_affect_task] !== undefined) {
            this[sym_affect_task] = false;
            if (this.initializing) {
                try {
                    this[sym_affect]();
                } finally {
                    Object.defineProperty(this, "initializing", { value: false });
                }
            } else {
                this[sym_affect]();
            }
        }
    },
});

Object.defineProperty(AffectorPrototype, "active", {
    get() {
        return this[sym_affect_task] !== undefined;
    },
    configurable: true,
});

function Effect() {
    if (!new.target) throw new TypeError("Constructor Effect requires 'new'");
    if (arguments.length < 2) throw new TypeError("Failed to construct 'Effect' 2 arguments required, but only " + arguments.length + " present");
    let name = "", i = 0;
    if (typeof arguments[0] == "string") {
        i = 1;
        name = arguments[0];
    }
    const affector = createAffector(name, arguments[arguments.length - 1], new.target.prototype);
    if (affector[sym_affect_task] !== undefined) {
        const refs = new Set();
        Object.defineProperty(affector, sym_affect_refs, { value: refs });
        for (; i < arguments.length - 1; i++) {
            const reference = arguments[i];
            let set = affectFunctionsWeakRefs.get(reference);
            if (!set) affectFunctionsWeakRefs.set(reference, set = new Set());
            set.add(affector);
            refs.add(reference);
        }
    }
    return affector;
}

defineProperties(Effect, {
    Persistent: function Persistent(name, affector) {
        if (!new.target) throw new TypeError("Constructor Effect.Persistent requires 'new'");
        if (arguments.length == 1) {
            affector = name;
            name = "";
        }
        affector = createAffector(name, affector, new.target.prototype);
        if (affector[sym_affect_task] !== undefined) affectFunctionsRefs.add(affector);
        return affector;
    },
    Weak: function Weak(name, affector) {
        if (!new.target) throw new TypeError("Constructor Effect.Weak requires 'new'");
        if (arguments.length == 1) {
            affector = name;
            name = "";
        }
        return createAffector(name, affector, new.target.prototype);
    },
    queue,
});

Effect.prototype = AffectorPrototype;
Effect.Persistent.prototype = AffectorPrototype;
Effect.Weak.prototype = AffectorPrototype;

function createAffector(name, affector, prototype) {
    if (typeof affector != "function") throw new TypeError("affector is not a function");
    name = name || affector.name || "Effect";
    const obj = Object.create(prototype);
    const weak = new WeakRef(obj);
    const affect = {
        [name]() {
            const transitive = obj[sym_affect_task];
            if (typeof transitive != "boolean") return;
            obj[sym_affect_task] = null;
            const pideps = obj[sym_pideps];
            if (transitive && !possibleInvalidationIsInvalidated(pideps, weak)) {
                return;
            }
            pideps.clear();

            const old_derived = current_derived;
            const old_derived_used = current_derived_used;
            current_derived = weak;
            try {
                affector(obj);
            } finally {
                current_derived = old_derived;
                current_derived_used = old_derived_used;
                if (obj.initializing) Object.defineProperty(obj, "initializing", { value: false });
            }
        }
    }[name];
    Object.defineProperty(obj, "name", { value: name });
    Object.defineProperty(obj, "initializing", { writable: true, value: true });
    Object.defineProperty(obj, sym_pideps, { value: new Map() });
    Object.defineProperty(obj, sym_weak, { value: weak });
    Object.defineProperty(obj, sym_affect, { value: affect });
    Object.defineProperty(obj, sym_affect_task, { writable: true, value: false });
    queue(affect);
    return obj;
}

function clearAffector(affector) {
    affector[sym_affect_task] = undefined;
    affector[sym_pideps].clear();
    const refs = affector[sym_affect_refs];
    if (refs) {
        for (const i of refs) {
            /** @type {Set | undefined} */
            const set = affectFunctionsWeakRefs.get(i);
            if (set && set.delete(affector) && set.size == 0) {
                affectFunctionsWeakRefs.delete(i);
            }
        }
        refs.clear();
    } else {
        affectFunctionsRefs.delete(affector);
    }
}

//#endregion
//#region invalidation

/** @param {{add(weak: WeakRef<Derived>): void}} set */
function useState(set) {
    if (current_derived) {
        set.add(current_derived);
        current_derived_used = true;
    } else if (current_derived == undefined) {
        const penalty = Derived.onUseDerivedOutsideOfDerivation;
        const msg = "State used outside of derivation";
        if (penalty === "throw") throw new Error(msg);
        if (typeof penalty == "function") penalty(msg);
    }
}

/** @param {{add(weak: WeakRef<Derived>): void}} set */
function useDerived(set) {
    if (current_derived) {
        set.add(current_derived);
        current_derived_used = true;
    } else if (current_derived == undefined) {
        const penalty = Derived.onUseDerivedOutsideOfDerivation;
        const msg = "Derived used outside of derivation";
        if (penalty === "throw") throw new Error(msg);
        if (typeof penalty == "function") penalty(msg);
    }
}

function prepareUseTracked() {
    if (current_derived) return current_derived_used = true;
    if (current_derived == undefined) {
        const penalty = Derived.onUseTrackedOutsideOfDerivation;
        const msg = "Tracked object used outside of derivation";
        if (penalty === "throw") throw new Error(msg);
        if (typeof penalty == "function") penalty(msg);
    }
}

/** @param {Derived} target @param {boolean} [transitive] */
function invalidateDerivation(target, transitive) {
    if (sym_affect_task in target) {
        const affect_task = target[sym_affect_task];
        if (affect_task === null) {
            target[sym_affect_task] = !!transitive;
            queue(target[sym_affect]);
        } else if (affect_task === true && !transitive) {
            target[sym_affect_task] = false;
        }
        return;
    }
    if (!transitive) target[sym_weak] = null;
    /** @type {Set<WeakRef<Derived>>} */
    const derivations = target[sym_ders];
    if (
        derivations.size == 0
        || recursiveDerivationInvalidationGuard.has(target)
    ) return;
    recursiveDerivationInvalidationGuard.add(target);

    let weak = null;
    const copy = Array.from(derivations);
    derivations.clear();
    for (let i = 0; i < copy.length; i++) {
        const derived = copy[i].deref();
        /* istanbul ignore next */
        if (derived && derived[sym_weak] === copy[i]) {
            if (!weak) {
                weak = target[sym_piweak];
                if (!weak) weak = target[sym_piweak] = new WeakRef(target);
            }
            if (!derived[sym_pideps].has(weak)) {
                derived[sym_pideps].set(weak, target[sym_value]);
            }
            // TODO! skip this call if the has call above returns true AND no affects are down the line waiting for invalidation
            invalidateDerivation(derived, true);
        }
    }
    recursiveDerivationInvalidationGuard.delete(target);
}
/** @param {Set<WeakRef<Derived>> | undefined | null} set */
function invalidateDerivationSet(set) {
    if (!set || !set.size) return;
    const src = Array.from(set);
    set.clear();
    const length = src.length;
    for (let i = 0; i < length; i++) {
        const derived = src[i].deref();
        /* istanbul ignore next */
        if (derived && derived[sym_weak] === src[i]) {
            invalidateDerivation(derived);
        }
    }
}
/** @param {Set<WeakRef<Derived>>[]} arr */
function invalidateDerivationList(arr) {
    const length = arr.length;
    for (let i = 0; i < length; i++) {
        invalidateDerivationSet(arr[i]);
    }
}

//#endregion
//#region utils

/**
 * @template T
 * @template P
 * @returns {T & P}
 */
function defineProperties(target, properties) {
    for (const key in properties) {
        Object.defineProperty(target, key, { writable: true, configurable: true, value: properties[key] });
    }
    return target;
}

//#endregion
//#region track

function track(value) {
    if (!value || typeof value != "object") return value;
    if (sym_tracked in value) return value[sym_tracked];
    const proto = Object.getPrototypeOf(value);
    if (!proto || proto == Object.prototype) {
        if (!Object.isExtensible(value)) {
            if (Object.isFrozen(value)) {
                // TODO! wrap the object in a dedicated proxy for frozen objects with untracked properties
                return value;
            }
            trackNonExtensibleError();
        }
        const proxy = new Proxy(value, StateObjectProxyHandler);
        Object.defineProperty(value, sym_ders, { value: { __proto__: null } });
        Object.defineProperty(value, sym_tracked, { value: proxy });
        const descriptors = Object.getOwnPropertyDescriptors(value);
        for (const key in descriptors) {
            const descriptor = descriptors[key];
            if (!("value" in descriptor)) continue;
            const old_prop_value = descriptor.value;
            const new_prop_value = track(old_prop_value);
            if (new_prop_value == old_prop_value) continue;
            if (descriptor.writable) {
                value[key] = new_prop_value;
            } else if (descriptor.configurable) {
                Object.defineProperty(value, key, {
                    value: new_prop_value,
                    writable: false,
                    enumerable: descriptor.enumerable,
                    configurable: true,
                });
            } else {
                // since writable and configurable is false, we can't update the property,
                // we can however change the way it is obtained through the proxy to return the correct tracked valued
                // hence we would need a call to the track function in the property getter
                // however, that might be too much of a performance hit, for such a small edge case (string-keyed data properties frozen before the call to track), so we are not doing that for now
                console.warn(`State.track: Could not wrap with tracking the property with key ${key} of object, because it is not configurable nor writable`);
                // TODO! wrap the object in a dedicated proxy for objects with untracked properties
            }
        }
        return proxy;
    } else if (proto == Array.prototype && Array.isArray(value)) {
        if (!Object.isExtensible(value)) {
            if (Object.isFrozen(value)) {
                // TODO! wrap the object in a dedicated proxy for frozen objects with untracked properties
                return value;
            }
            trackNonExtensibleError();
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        for (let key = 0; key < value.length; key++) {
            const descriptor = descriptors[key];
            if (!("value" in descriptor)) continue;
            const old_prop_value = descriptor.value;
            const new_prop_value = track(old_prop_value);
            if (new_prop_value == old_prop_value) continue;
            if (descriptor.writable) {
                value[key] = new_prop_value;
            } else if (descriptor.configurable) {
                Object.defineProperty(value, key, {
                    value: new_prop_value,
                    writable: false,
                    enumerable: descriptor.enumerable,
                    configurable: true,
                });
            } else {
                // since writable and configurable is false, we can't update the property,
                // we can however change the way it is obtained through the proxy to return the correct tracked valued
                // hence we would need a call to the track function in the property getter
                // however, that might be too much of a performance hit, for such a small edge case (string-keyed data properties frozen before the call to track), so we are not doing that for now
                console.warn(`State.track: Could not wrap with tracking the item at index ${key} of array, because it is not configurable nor writable`);
                // TODO! wrap the object in a dedicated proxy for objects with untracked properties
            }
        }

        const proxy = new Proxy(value, StateArrayProxyHandler);
        const length = value.length || 0;
        Object.setPrototypeOf(value, StateArrayPrototype);
        Object.defineProperty(value, sym_ders, { value: Array(length) });
        Object.defineProperty(value, sym_ders_slots, { value: Array(length) });
        Object.defineProperty(value, sym_slots, { value: Array(length) });
        Object.defineProperty(value, sym_len, { value: new Set() });
        Object.defineProperty(value, sym_all, { value: new Set() });
        Object.defineProperty(value, sym_value, { value });
        Object.defineProperty(value, sym_tracked, { value: proxy });
        return proxy;
    } else if (value instanceof Promise) {
        if (!Object.isExtensible(value)) trackNonExtensibleError();
        const promise = Object.defineProperty(value, sym_tracked, { value });
        promise.then(
            function trackPromiseResolution(value) {
                if (sym_resolved in promise || sym_rejected in promise) return;
                Object.defineProperty(promise, sym_resolved, { value });
                const ders = promise[sym_ders_resolved];
                delete promise[sym_ders_resolved];
                delete promise[sym_ders_rejected];
                invalidateDerivationSet(ders);
            },
            function trackPromiseRejection(value) {
                if (sym_resolved in promise || sym_rejected in promise) return;
                Object.defineProperty(promise, sym_rejected, { value });
                const ders = promise[sym_ders_rejected];
                delete promise[sym_ders_resolved];
                delete promise[sym_ders_rejected];
                invalidateDerivationSet(ders);
            },
        );
    } else if (proto == Map.prototype) {
        if (!Object.isExtensible(value)) trackNonExtensibleError();
        for (const key of value.keys()) {
            const old_value = value.get(key);
            const new_value = track(old_value);
            if (old_value != new_value) value.set(key, new_value);
        }
        Object.setPrototypeOf(value, StateMapPrototype);
        Object.defineProperty(value, sym_ders, { value: new Map() });
        Object.defineProperty(value, sym_len, { value: new Set() });
        Object.defineProperty(value, sym_all, { value: new Set() });
        Object.defineProperty(value, sym_tracked, { value });
    } else if (proto == Set.prototype) {
        if (!Object.isExtensible(value)) trackNonExtensibleError();
        Object.setPrototypeOf(value, StateSetPrototype);
        Object.defineProperty(value, sym_ders, { value: new Map() });
        Object.defineProperty(value, sym_all, { value: new Set() });
        Object.defineProperty(value, sym_tracked, { value });
    } else if (proto == Date.prototype) {
        if (!Object.isExtensible(value)) trackNonExtensibleError();
        Object.setPrototypeOf(value, StateDatePrototype);
        Object.defineProperty(value, sym_ders, { value: new Set() });
        Object.defineProperty(value, sym_tracked, { value });
    }
    return value;
}

function trackNonExtensibleError() {
    // TODO! add a test for this
    throw new TypeError("can't track object that is not extensible");
}

//#endregion
//#region freeze

function freeze(value) {
    if (!value || typeof value != "object") return value;
    if (sym_tracked in value) return value[sym_tracked];
    const proto = Object.getPrototypeOf(value);
    if (!proto || proto == Object.prototype) {
        if (!Object.isExtensible(value)) {
            if (Object.isFrozen(value)) {
                // TODO! wrap the object in a dedicated proxy for frozen objects with untracked properties
                return value;
            }
            trackNonExtensibleError();
        }
        Object.defineProperty(value, sym_ders, { value: { __proto__: null } });
        Object.defineProperty(value, sym_tracked, { value: value });
        const descriptors = Object.getOwnPropertyDescriptors(value);
        for (const key in descriptors) {
            const descriptor = descriptors[key];
            if (!("value" in descriptor)) continue;
            const old_prop_value = descriptor.value;
            const new_prop_value = track(old_prop_value);
            if (new_prop_value == old_prop_value) continue;
            if (descriptor.writable) {
                value[key] = new_prop_value;
            } else if (descriptor.configurable) {
                Object.defineProperty(value, key, {
                    value: new_prop_value,
                    writable: false,
                    enumerable: descriptor.enumerable,
                    configurable: true,
                });
            } else {
                // since writable and configurable is false, we can't update the property,
                // we can't even change the way it is obtained through the proxy to return the correct tracked valued, because there is no proxy for frozen objects
                console.warn(`State.freeze: Could not wrap with tracking the property with key ${key} of object, because it is not configurable nor writable`);
                // TODO! wrap the object in a dedicated proxy for objects with untracked properties
            }
        }
        return Object.freeze(value);
    } else if (proto == Array.prototype && Array.isArray(value)) {
        if (!Object.isExtensible(value)) {
            if (Object.isFrozen(value)) {
                // TODO! wrap the object in a dedicated proxy for frozen objects with untracked properties
                return value;
            }
            trackNonExtensibleError();
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        for (let key = 0; key < value.length; key++) {
            const descriptor = descriptors[key];
            if (!("value" in descriptor)) continue;
            const old_prop_value = descriptor.value;
            const new_prop_value = track(old_prop_value);
            if (new_prop_value == old_prop_value) continue;
            if (descriptor.writable) {
                value[key] = new_prop_value;
            } else if (descriptor.configurable) {
                Object.defineProperty(value, key, {
                    value: new_prop_value,
                    writable: false,
                    enumerable: descriptor.enumerable,
                    configurable: true,
                });
            } else {
                // since writable and configurable is false, we can't update the property,
                // we can't even change the way it is obtained through the proxy to return the correct tracked valued, because there is no proxy for frozen objects
                console.warn(`State.freeze: Could not wrap with tracking the item at index ${key} of array, because it is not configurable nor writable`);
                // TODO! wrap the object in a dedicated proxy for objects with untracked properties
            }
        }
        return Object.freeze(value);
    } else if (value instanceof Promise) {
        if (!Object.isExtensible(value)) trackNonExtensibleError();
        const promise = Object.defineProperty(value, sym_tracked, { value });
        promise.then(
            function trackPromiseResolution(value) {
                if (sym_resolved in promise || sym_rejected in promise) return;
                Object.defineProperty(promise, sym_resolved, { value });
                const ders = promise[sym_ders_resolved];
                delete promise[sym_ders_resolved];
                delete promise[sym_ders_rejected];
                invalidateDerivationSet(ders);
            },
            function trackPromiseRejection(value) {
                if (sym_resolved in promise || sym_rejected in promise) return;
                Object.defineProperty(promise, sym_rejected, { value });
                const ders = promise[sym_ders_rejected];
                delete promise[sym_ders_resolved];
                delete promise[sym_ders_rejected];
                invalidateDerivationSet(ders);
            },
        );
        return value;
    } else if (proto == Map.prototype) {
        if (!Object.isExtensible(value)) trackNonExtensibleError();
        for (const key of value.keys()) {
            const old_value = value.get(key);
            const new_value = track(old_value);
            if (old_value != new_value) value.set(key, new_value);
        }
        Object.setPrototypeOf(value, StateMapPrototype);
        Object.defineProperty(value, sym_ders, { value: new Map() });
        Object.defineProperty(value, sym_len, { value: new Set() });
        Object.defineProperty(value, sym_all, { value: new Set() });
        Object.defineProperty(value, sym_tracked, { value });
    } else if (proto == Set.prototype) {
        if (!Object.isExtensible(value)) trackNonExtensibleError();
        Object.setPrototypeOf(value, StateSetPrototype);
        Object.defineProperty(value, sym_ders, { value: new Map() });
        Object.defineProperty(value, sym_all, { value: new Set() });
        Object.defineProperty(value, sym_tracked, { value });
    }
    return Object.freeze(value);
}

function is(a, b) {
    if (Object.is(a, b)) return true;
    if (typeof a != "object" || typeof b != "object" || !a || !b) return false;
    // this may break if a proxy trap for getPrototype, isExtensible or ownKeys calls State.is from State.isr
    // none of the aforementioned traps can call State.is or user code for now, so this is safe
    // TODO! the reasoning above is no longer valid with derived arrays, fix this
    remainingFrozenComparisonsDepth = maximumFrozenComparisonsDepth;
    try {
        return isr(a, b);
    } catch {
        return false;
    }
}

function isr(a, b) {
    if (Object.is(a, b)) return true;
    if (typeof a != "object" || typeof b != "object" || !a || !b) return false;
    let descriptors_a, descriptors_b;
    try {
        if (Object.getPrototypeOf(a) != Object.getPrototypeOf(b) || !Object.isFrozen(a) || !Object.isFrozen(b)) return false;
        descriptors_a = Object.getOwnPropertyDescriptors(a);
        descriptors_b = Object.getOwnPropertyDescriptors(b);
    } catch {
        return false;
    }
    for (const key_b in descriptors_b) {
        const prop_b = descriptors_b[key_b];
        if ("value" in prop_b && !(key_b in descriptors_a && "value" in descriptors_a[key_b])) return false;
    }
    if (remainingFrozenComparisonsDepth == 0) {
        if (recursiveFrozenComparisonGuard.has(a) || recursiveFrozenComparisonGuard.has(b)) {
            // State.is can't compare self referential frozen objects
            return false;
        }
        recursiveFrozenComparisonGuard.add(a);
        recursiveFrozenComparisonGuard.add(b);
        try {
            for (const key_a in descriptors_a) {
                const prop_a = descriptors_a[key_a];
                const prop_b = descriptors_b[key_a];
                if (!prop_b || ("value" in prop_a
                    ? !("value" in prop_b) || !isr(prop_a.value, prop_b.value)
                    : prop_a.get !== prop_b.get || prop_a.set !== prop_b.set
                )) {
                    return false;
                }
            }
            return true;
        } finally {
            recursiveFrozenComparisonGuard.delete(a);
            recursiveFrozenComparisonGuard.delete(b);
        }
    } else {
        // it is safe to leave remainingFrozenComparisonsDepth dirty on the case of an exception
        // because it will be reinitialized on the next call to State.is
        remainingFrozenComparisonsDepth--;
        for (const key_a in descriptors_a) {
            const prop_a = descriptors_a[key_a];
            const prop_b = descriptors_b[key_a];
            if (!prop_b || ("value" in prop_a
                ? !("value" in prop_b) || !isr(prop_a.value, prop_b.value)
                : prop_a.get !== prop_b.get || prop_a.set !== prop_b.set
            )) {
                remainingFrozenComparisonsDepth++;
                return false;
            }
        }
        remainingFrozenComparisonsDepth++;
        return true;
    }
}

//#endregion
//#region derived array

function mutationOnDerivedArray() {
    throw new TypeError("cannot mutate derived array");
}

/**
 * @template T



 */
function createDerivedArray(target, handler) {
    const target2 = [];
    const proxy = new Proxy(target2, DerivedArrayProxyHandler);
    Object.setPrototypeOf(target2, DerivedArrayPrototype);
    target2[sym_target] = target;
    target2[sym_handler] = handler;
    target2[sym_tracked] = proxy;
    return proxy;
}

function DerivedArray() {
    // return StateArray instances and not DerivedArray instances,
    // this serves as a constructor with a different name for the DerivedArrayPrototype for better debugging
    // we return StateArray here to allow deep clones, jest needs it and possibly other libraries too
    return StateArray.apply(null, arguments);
}

const DerivedArrayPrototype = defineProperties({ __proto__: Array.prototype }, {
    constructor: DerivedArray,
    push() { mutationOnDerivedArray(); },
    pop() { mutationOnDerivedArray(); },
    unshift() { mutationOnDerivedArray(); },
    shift() { mutationOnDerivedArray(); },
    splice() { mutationOnDerivedArray(); },
    sort() { mutationOnDerivedArray(); },
    reverse() { mutationOnDerivedArray(); },
    copyWithin() { mutationOnDerivedArray(); },
    fill() { mutationOnDerivedArray(); },
    $slot(index) {
        const i = as_index(index);
        if (i === undefined) throw new RangeError("argument is not a valid index: " + index);
        return this[sym_handler].symbol && this[sym_handler].symbol(this[sym_target], i);
    },
    $slots() {
        const handler = this[sym_handler];
        if (handler.symbols) return handler.symbols(this[sym_target]);
        if (handler.symbol) {
            const target = this[sym_target];
            const length = this.length;
            const arr = Array(length);
            for (let i = 0; i < length; i++) {
                arr[i] = handler.symbol(target, i);
            }
            return arr;
        }
        return Array(length);
    },
    $slotValue(index) {
        if (typeof index != "symbol") throw new TypeError("argument is not a symbol");
        return this[sym_handler].symbol && this[sym_handler].item(this[sym_target], index);
    },
    $slotExists(index) {
        if (typeof index != "symbol") throw new TypeError("argument is not a symbol");
        return !!(this[sym_handler].symbol && this[sym_handler].has(this[sym_target], index));
    },
    $use() {
        if (this[sym_handler].use) {
            this[sym_handler].use(this[sym_target]);
        } else {
            const length = this.length;
            for (let i = 0; i < length; i++) {
                void this[i];
            }
        }
    },
    $map(derivator, thisArg) {
        return createDerivedArray({
            fn: thisArg ? derivator.bind(thisArg) : derivator,
            src: this,
            imap: Array(0),
            map: new WeakMap(),
        }, mapArrayProxyHandler);
    },
});

defineProperties(DerivedArray, {
    proxy(target, handler) {
        return createDerivedArray(target, handler);
    },
    range(length, fn) {
        if (!fn) {
            return length instanceof Derived
                ? createDerivedArray(length, derivedLengthRangeArrayProxyHandler)
                : createDerivedArray(validate_length(length), constantLengthRangeArrayProxyHandler);
        }
        if (length instanceof Derived) {
            const target = Array(0);
            target.len = length;
            target.fn = fn;
            return createDerivedArray(target, derivedLengthMappedRangeArrayProxyHandler);
        } else {
            const target = Array(validate_length(length));
            target.fn = fn;
            return createDerivedArray(target, constantLengthMappedRangeArrayProxyHandler);
        }
    },
    empty: sym_empty,
});

DerivedArray.prototype = DerivedArrayPrototype;

/** @type {ProxyHandler<{[sym_handler]: import(".").Derived.Array.ProxyHandler, [sym_target]: any[]}>} */
const DerivedArrayProxyHandler = {
    //apply(target, thisArg, argArray) {
    //    return Reflect.apply(target, thisArg, argArray);
    //},
    //construct(target, thisArg, argArray) {
    //    return Reflect.construct(target, thisArg, argArray);
    //},
    defineProperty() {
        throw new TypeError("cannot define properties on a Derived Array");
    },
    deleteProperty() {
        throw new TypeError("cannot delete properties on a Derived Array");
    },
    get(target, p, receiver) {
        if (p === "length") {
            return validate_length(target[sym_handler].length(target[sym_target]));
        }
        const index = as_index(p);
        if (index == undefined) return Reflect.get(target, p, receiver);
        const value = target[sym_handler].item(target[sym_target], index);
        return value === sym_empty ? undefined : value;
    },
    getOwnPropertyDescriptor(target, p) {
        if (p === "length") return {
            value: validate_length(target[sym_handler].length(target[sym_target])),
            writable: true,
            enumerable: false,
            configurable: false,
        };
        const index = as_index(p);
        if (index == undefined) return Reflect.getOwnPropertyDescriptor(target, p);
        const value = target[sym_handler].item(target[sym_target], index);
        return {
            value: value === sym_empty ? undefined : value,
            writable: false,
            enumerable: false,
            configurable: true,
        };
    },
    // getPrototypeOf(target) {
    //     return Reflect.getPrototypeOf(target);
    // },
    has(target, p) {
        if (p === "length") return true;
        const index = as_index(p);
        if (index == undefined) return Reflect.has(target, p);
        const handler = target[sym_handler];
        return handler.has ? !!handler.has(target[sym_target], index) : handler.item(target[sym_target], index) !== sym_empty;
    },
    isExtensible(target) {
        return true;
    },
    ownKeys(target) {
        const handler = target[sym_handler];
        target = target[sym_target];
        handler.use && handler.use();
        const length = validate_length(handler.length(target));
        const keys = [];
        if (handler.has) {
            for (let i = 0; i < keys.length; i++) {
                if (handler.has(target, i)) {
                    keys[keys.length] = "" + i;
                }
            }
        } else {
            for (let i = 0; i < keys.length; i++) {
                if (handler.item(target, i) !== sym_empty) {
                    keys[keys.length] = "" + i;
                }
            }
        }
        keys[keys.length] = "length";
        keys[keys.length] = sym_handler;
        keys[keys.length] = sym_target;
        keys[keys.length] = sym_tracked;
        return keys;
    },
    preventExtensions() {
        throw new TypeError("cannot prevent extensions of a Derived Array");
    },
    set() {
        throw new TypeError("cannot set properties of a Derived Array");
    },
    setPrototypeOf() {
        throw new TypeError("cannot set the prototype of a Derived Array");
    },
};

function validate_length(length) {
    if (typeof length == "number" && length >= 0 && length <= 0xFFFFFFFF && Number.isInteger(length)) return length;
    throw new RangeError("Derived Array Proxy length method returned an invalid value: " + length);
}

//#endregion
//#region derived range array

/** @type {import(".").Derived.Array.ProxyHandlerWithoutSymbol<number>} */
const constantLengthRangeArrayProxyHandler = {
    length(length) {
        return length;
    },
    item(length, index) {
        return index < length ? index : sym_empty;
    },
    has(length, index) {
        return index < length;
    },
    use() { },
};

/** @type {import(".").Derived.Array.ProxyHandlerWithoutSymbol<import(".").Derived<any>>} */
const derivedLengthRangeArrayProxyHandler = {
    length(length) {
        return validate_length(length());
    },
    item(length, index) {
        return index < validate_length(length()) ? index : sym_empty;
    },
    has(length, index) {
        return index < validate_length(length());
    },
    use(length) {
        validate_length(length());
    },
};

/** @type {import(".").Derived.Array.ProxyHandlerWithoutSymbol<(import(".").Derived<any> | undefined)[] & { fn: (index: number) => any }>} */
const constantLengthMappedRangeArrayProxyHandler = {
    length(target) {
        return target.length;
    },
    item(target, index) {
        if (index >= target.length) return sym_empty
        const value = (
            target[index] || (target[index] = new Derived(function mappedRangeItem() {
                return (0, target.fn)(index);
            }))
        )();
        if (value == sym_empty) throw new TypeError("Derived.Array.range fn returned Derived.Array.empty");
        return value;
    },
    has(target, index) {
        return index < target.length;
    },
    use(target) {
        const length = target.length;
        const fn = target.fn;
        for (let i = 0; i < length; i++) {
            const index = i;
            if (sym_empty == (
                target[index] || (target[index] = new Derived(function mappedRangeItem() {
                    return (0, target.fn)(index);
                }))
            )()) throw new TypeError("Derived.Array.range fn returned Derived.Array.empty");
        }
    },
};

/** @type {import(".").Derived.Array.ProxyHandlerWithoutSymbol<(import(".").Derived<any> | undefined)[] & { len: import(".").Derived<any>, fn: (index: number) => any }>} */
const derivedLengthMappedRangeArrayProxyHandler = {
    length(target) {
        return target.length = validate_length(target.len());
    },
    item(target, index) {
        if (index >= (target.length = validate_length(target.len()))) return sym_empty;
        const value = (
            target[index] || (target[index] = new Derived(function mappedRangeItem() {
                return (0, target.fn)(index);
            }))
        )();
        if (value == sym_empty) throw new TypeError("Derived.Array.range fn returned Derived.Array.empty");
        return value;
    },
    has(target, index) {
        return index < (target.length = validate_length(target.len()));
    },
    use(target) {
        const length = (target.length = validate_length(target.len()));
        const fn = target.fn;
        for (let i = 0; i < length; i++) {
            const index = i;
            if (sym_empty == (
                target[index] || (target[index] = new Derived(function mappedRangeItem() {
                    return (0, target.fn)(index);
                }))
            )()) throw new TypeError("Derived.Array.range fn returned Derived.Array.empty");
        }
    },
};

//#endregion
//#region derived map array

/** @type {import(".").Derived.Array.ProxyHandler<{ src: any[], fn(item: any): any, imap: import(".").Derived<any>[], map: WeakMap<symbol, import(".").Derived<any>> }>} */
const mapArrayProxyHandler = {
    length(target) {
        return target.src.length;
    },
    item(target, index) {
        if (typeof index == "number") {
            const slot = target.src.$slot(index);
            if (!slot) {
                return (target.imap[index] || (target.imap[index] = new Derived(function mapItem() {
                    return index in target.src ? (0, target.fn)(target.src[index]) : sym_empty;
                })))();
            }
            index = slot;
        }
        let derived = target.map.get(index);
        if (!derived) {
            target.map.set(index, derived = new Derived(function mapItem() {
                const value = target.src.$slotValue(index);
                if (value === sym_empty) throw new Error("attempted to evaluate mapItem with a symbol from a slot that no longer exists");
                return (0, target.fn)(value);
            }));
        }
        return derived();
    },
    has(target, index) {
        return typeof index == "symbol" ? target.src.$slotExists(index) : index in target.src;
    },
    symbol(target, index) {
        return target.src.$slot(index);
    },
    symbols(target) {
        return target.src.$slots();
    },
    use(target) {
        target.src.$use();
        const slots = target.src.$slots();
        const length = slots.length;
        for (let i = 0; i < length; i++) {
            const derived = target.map.get(i);
            if (derived) derived();
        }
    },
};

//#endregion
//#region derived date

function mutationOnDerivedDate() {
    throw new TypeError("cannot mutate derived date");
}

function DerivedDate() {
    // see comment in the implementation of DerivedArray for the reasoning behind this code
    if (!new.target) throw new TypeError("Constructor DerivedDate requires 'new'");
    return Reflect.construct(StateDate, arguments, StateDate); // override new.target to always use StateDate, we don't want the DerivedDate prototype
}

const DerivedDatePrototype = { __proto__: Date.prototype };

DerivedDate.prototype = DerivedDatePrototype;

defineProperties(DerivedDate, {
    proxy(handler) {
        if (typeof handler != "function") throw new TypeError("handler is not a function");
        const value = Reflect.construct(Date, [0], DerivedDate);
        Object.defineProperty(value, sym_handler, { value: handler });
        Object.defineProperty(value, sym_tracked, { value });
        return value;
    },
    clock(precision, timezone, frame) {
        if (!arguments.length) {
            return typeof globalThis.requestAnimationFrame == "function" ? clocks.lrse : clocks.lise;
        }
        switch (precision) {
            default:
                if (typeof precision != "string") throw new TypeError("precision is not a string");
                throw new TypeError('expected precision parameter to be one either "ms", "second", "minute", "hour" or "day", got "' + precision + '"');
            case undefined:
                precision = "se";
            case "ms":
            case "second":
            case "minute":
            case "hour":
            case "day":
        }
        switch (timezone) {
            default:
                if (typeof timezone != "string") throw new TypeError("timezone is not a string");
                throw new TypeError('expected timezone parameter to be one either "local" or "utc", got "' + timezone + '"');
            case undefined:
                timezone = "l";
            case "local":
            case "utc":
        }
        switch (frame) {
            default:
                if (typeof frame != "string") throw new TypeError("frame is not a string");
                throw new TypeError('expected frame parameter to be one either "respect frame" or "ignore frame", got "' + frame + '"');
            case undefined:
            case "respect frame":
                if (typeof globalThis.requestAnimationFrame == "function") {
                    frame = "r";
                } else if (frame) {
                    throw new Error("Cannot create a clock that respects the frame because requestAnimationFrame is not available");
                } else {
                    frame = "i";
                }
                break;
            case "ignore frame":
        }
        return clocks[timezone[0] + frame[0] + precision.slice(0, 2)];
    },
    isPast(date) {
        if (typeof date != "number") {
            if (typeof date == "string") date = new Date(date);
            if (!(date instanceof Date)) {
                throw new TypeError("expected a number, string or Date");
            }
            date = date.getTime();
        }
        return Date.now() >= date || !!invalidateThen(date);
    },
    isFuture(date) {
        if (!(date instanceof Date)) date = new Date(date);
        return Date.now() < date && !invalidateThen(date);
    },
});

/** @type {Record<string, Date>} */
const clocks = function () {
    // TODO! optimize frame respecting millisecond event to a single requestAnimationFrame call
    const millisecond_ders = new Set();
    const second_ders = new Set();
    const minute_ders = new Set();
    const local_hour_ders = new Set();
    const utc_hour_ders = new Set();
    const local_day_ders = new Set();
    const utc_day_ders = new Set();

    const frame_millisecond_ders = new Set();
    const frame_second_ders = new Set();
    const frame_minute_ders = new Set();
    const frame_local_hour_ders = new Set();
    const frame_utc_hour_ders = new Set();
    const frame_local_day_ders = new Set();
    const frame_utc_day_ders = new Set();

    const second_ms = 1000;
    const minute_ms = second_ms * 60;
    const hour_ms = minute_ms * 60;
    const day_ms = hour_ms * 24;

    let second_past = 0;
    let minute_past = 0;
    let local_hour_past = 0;
    let utc_hour_past = 0;
    let local_day_past = 0;
    let utc_day_past = 0;

    let timeout = 0;
    let timeout_until = 0;

    const queue_schedule_timeout_microtask = future => {
        if (!timeout_until || timeout_until > future) {
            if (timeout) {
                clearTimeout(timeout);
                timeout = 0;
                timeout_until = 0;
            }
            queueMicrotask(schedule_timeout_microtask);
            timeout_until = future;
        }
    };

    const schedule_timeout_microtask = () => {
        const delay = timeout_until - Date.now();
        // console.log("delay: " + delay);
        timeout = setTimeout(timeout_handler, delay < 0 ? 0 : delay);
    };

    const timeout_handler = () => {
        // console.log("time: " + new Date().toLocaleTimeString() + "." + new Date().getMilliseconds().toString().padStart(3, "0"));
        timeout = 0;
        timeout_until = 0;
        let my_timeout_until = 0;
        let now;
        const frame_ders = [];
        if (frame_local_day_ders.size || frame_local_hour_ders.size || local_day_ders.size || local_hour_ders.size) {
            const date = new Date();
            now = date.getTime();
            const new_local_hour_past = date.setHours(date.getHours(), 0, 0, 0);
            const new_local_day_past = date.setHours(0, 0, 0, 0);
            if (frame_local_hour_ders.size || local_hour_ders.size) {
                if (local_hour_past != new_local_hour_past) {
                    local_hour_past = 0;
                    invalidateDerivationSet(local_hour_ders);
                    frame_ders.push(...frame_local_hour_ders);
                    frame_local_hour_ders.clear();
                } else if (!my_timeout_until || my_timeout_until > new_local_hour_past + hour_ms) {
                    my_timeout_until = new_local_hour_past + hour_ms;
                }
            }
            if (frame_local_day_ders.size || local_day_ders.size) {
                if (local_day_past != new_local_day_past) {
                    local_day_past = 0;
                    invalidateDerivationSet(local_day_ders);
                    frame_ders.push(...frame_local_day_ders);
                    frame_local_day_ders.clear();
                } else if (!my_timeout_until || my_timeout_until > new_local_day_past + day_ms) {
                    my_timeout_until = new_local_day_past + day_ms;
                }
            }
        } else {
            now = Date.now();
        }
        const new_utc_day_past = now - now % day_ms;
        const new_utc_hour_past = now - now % hour_ms;
        const new_minute_past = now - now % minute_ms;
        const new_second_past = now - now % second_ms;
        if (frame_utc_day_ders.size || utc_day_ders.size) {
            if (utc_day_past != new_utc_day_past) {
                utc_day_past = 0;
                invalidateDerivationSet(utc_day_ders);
                frame_ders.push(...frame_utc_day_ders);
                frame_utc_day_ders.clear();
            } else if (!my_timeout_until || my_timeout_until > new_utc_day_past + day_ms) {
                my_timeout_until = new_utc_day_past + day_ms;
            }
        }
        if (frame_utc_hour_ders.size || utc_hour_ders.size) {
            if (utc_hour_past != new_utc_hour_past) {
                utc_hour_past = 0;
                invalidateDerivationSet(utc_hour_ders);
                frame_ders.push(...frame_utc_hour_ders);
                frame_utc_hour_ders.clear();
            } else if (!my_timeout_until || my_timeout_until > new_utc_hour_past + hour_ms) {
                my_timeout_until = new_utc_hour_past + hour_ms;
            }
        }
        if (frame_minute_ders.size || minute_ders.size) {
            if (minute_past != new_minute_past) {
                minute_past = 0;
                invalidateDerivationSet(minute_ders);
                frame_ders.push(...frame_minute_ders);
                frame_minute_ders.clear();
            } else if (!my_timeout_until || my_timeout_until > new_minute_past + minute_ms) {
                my_timeout_until = new_minute_past + minute_ms;
            }
        }
        if (frame_second_ders.size || second_ders.size) {
            if (second_past != new_second_past) {
                second_past = 0;
                invalidateDerivationSet(second_ders);
                frame_ders.push(...frame_second_ders);
                frame_second_ders.clear();
            } else if (!my_timeout_until || my_timeout_until > new_second_past + second_ms) {
                my_timeout_until = new_second_past + second_ms;
            }
        }
        invalidateDerivationSet(millisecond_ders);
        frame_ders.push(...millisecond_ders);
        millisecond_ders.clear();
        if (my_timeout_until) queue_schedule_timeout_microtask(my_timeout_until);
        if (frame_ders.length) requestAnimationFrame(() => {
            const length = frame_ders.length;
            for (let i = 0; i < length; i++) {
                const derived = frame_ders[i].deref();
                /* istanbul ignore next */
                if (derived && derived[sym_weak] === frame_ders[i]) {
                    invalidateDerivation(derived);
                }
            }
        });
    };

    const millisecond_handler = ders => {
        const now = Date.now();
        if (prepareUseTracked()) {
            ders.add(current_derived);
            timeout_until = 0;
            queue_schedule_timeout_microtask(now);
        }
        return now;
    };
    const second_handler = ders => {
        const now = Date.now();
        const past = now - now % second_ms;
        const future = past + second_ms;
        if (prepareUseTracked()) {
            ders.add(current_derived);
            queue_schedule_timeout_microtask(future);
            if (!second_past) second_past = past;
        }
        return past;
    };
    const minute_handler = ders => {
        const now = Date.now();
        const past = now - now % minute_ms;
        const future = past + minute_ms;
        if (prepareUseTracked()) {
            ders.add(current_derived);
            queue_schedule_timeout_microtask(future);
            if (!minute_past) minute_past = past;
        }
        return past;
    };
    const local_hour_handler = ders => {
        const date = new Date();
        const past = date.setHours(date.getHours(), 0, 0, 0);
        const future = past + hour_ms;
        if (prepareUseTracked()) {
            ders.add(current_derived);
            queue_schedule_timeout_microtask(future);
            if (!local_hour_past) local_hour_past = past;
        }
        return past;
    };
    const utc_hour_handler = ders => {
        const now = Date.now();
        const past = now - now % hour_ms;
        const future = past + hour_ms;
        if (prepareUseTracked()) {
            ders.add(current_derived);
            queue_schedule_timeout_microtask(future);
            if (!utc_hour_past) utc_hour_past = past;
        }
        return past;
    };
    const local_day_handler = ders => {
        const date = new Date();
        const past = date.setHours(0, 0, 0, 0);
        const future = past + day_ms;
        if (prepareUseTracked()) {
            ders.add(current_derived);
            queue_schedule_timeout_microtask(future);
            if (!local_day_past) local_day_past = past;
        }
        return past;
    };
    const utc_day_handler = ders => {
        const now = Date.now();
        const past = now - now % day_ms;
        const future = past + day_ms;
        if (prepareUseTracked()) {
            ders.add(current_derived);
            queue_schedule_timeout_microtask(future);
            if (!utc_day_past) utc_day_past = past;
        }
        return past;
    };

    const proxy = DerivedDate.proxy;
    return {
        __proto__: null,
        lrms: proxy(millisecond_handler.bind(null, frame_millisecond_ders)),
        lims: proxy(millisecond_handler.bind(null, millisecond_ders)),
        urms: proxy(millisecond_handler.bind(null, frame_millisecond_ders)),
        uims: proxy(millisecond_handler.bind(null, millisecond_ders)),
        lrse: proxy(second_handler.bind(null, frame_second_ders)),
        lise: proxy(second_handler.bind(null, second_ders)),
        urse: proxy(second_handler.bind(null, frame_second_ders)),
        uise: proxy(second_handler.bind(null, second_ders)),
        lrmi: proxy(minute_handler.bind(null, frame_minute_ders)),
        limi: proxy(minute_handler.bind(null, minute_ders)),
        urmi: proxy(minute_handler.bind(null, frame_minute_ders)),
        uimi: proxy(minute_handler.bind(null, minute_ders)),
        lrho: proxy(local_hour_handler.bind(null, frame_local_hour_ders)),
        liho: proxy(local_hour_handler.bind(null, local_hour_ders)),
        urho: proxy(utc_hour_handler.bind(null, frame_utc_hour_ders)),
        uiho: proxy(utc_hour_handler.bind(null, utc_hour_ders)),
        lrda: proxy(local_day_handler.bind(null, frame_local_day_ders)),
        lida: proxy(local_day_handler.bind(null, local_day_ders)),
        urda: proxy(utc_day_handler.bind(null, frame_utc_day_ders)),
        uida: proxy(utc_day_handler.bind(null, utc_day_ders)),
    };
}();

let invalidate_then_timeout = 0;
let invalidate_then_timeout_until = 0;
/** @type {(Set<WeakRef<Derived>> & {time: number})[]} */
const invalidate_then_jobs = [];

/** @param {number} time @returns {undefined} */
function invalidateThen(time) {
    if (prepareUseTracked()) {
        if (!invalidate_then_timeout_until || time < invalidate_then_timeout_until) {
            if (invalidate_then_timeout) clearTimeout(invalidate_then_timeout);
            const delay = time - Date.now();
            invalidate_then_timeout = setTimeout(invalidateThenTimeoutHandler, delay < 0 ? 0 : delay);
            invalidate_then_timeout_until = time;
        }

        let low = 0, high = invalidate_then_jobs.length;

        if (high && time <= invalidate_then_jobs[high - 1].time) {
            low = high;
        } else if (!(high && time >= invalidate_then_jobs[0].time)) {
            while (low < high) {
                const mid = (low + high) >> 1;
                if (invalidate_then_jobs[mid].time < time) {
                    low = mid + 1;
                } else {
                    high = mid;
                }
            }
        }

        if (invalidate_then_jobs[low] && invalidate_then_jobs[low].time === time) {
            invalidate_then_jobs[low].add(current_derived);
        } else {
            const newSet = new Set();
            newSet.time = time;
            newSet.add(current_derived);
            invalidate_then_jobs.splice(low, 0, newSet);
        }
    }
}

function invalidateThenTimeoutHandler() {
    invalidate_then_timeout = 0;
    invalidate_then_timeout_until = 0;
    if (!invalidate_then_jobs.length) return;
    let now = Date.now();
    do {
        const last = invalidate_then_jobs[invalidate_then_jobs.length - 1];
        if (last.time > now) {
            now = Date.now();
            if (last.time > now) {
                invalidate_then_timeout = setTimeout(invalidateThenTimeoutHandler, last.time - now);
                invalidate_then_timeout_until = last.time;
                return;
            }
        }
        invalidateDerivationSet(last);
    } while (--invalidate_then_jobs.length);
}

//#endregion
//#region state object

// TODO! add static methods to constructors of state objects, arrays map set and promise

function StateObject() {
    const value = new.target ? this : {};
    const proxy = new Proxy(value, StateObjectProxyHandler);
    Object.defineProperty(value, sym_ders, { value: { __proto__: null } });
    Object.defineProperty(value, sym_tracked, { value: proxy });
    return proxy;
}

defineProperties(StateObject, {
    [Symbol.hasInstance]: function isStateObject(target) {
        return target && typeof target == "object" && sym_tracked in target;
    },
    use(target) {
        if (!target || typeof target !== "object") throw new TypeError("target is not an Object");
        if (!prepareUseTracked()) return;
        const ders = target[sym_ders];
        if (!ders) return;
        let set = ders[sym_all];
        if (!set) ders[sym_all] = set = new Set();
        set.add(current_derived);
    },
    fromEntries: function fromEntries() {
        return track(Object.fromEntries.apply(Object, arguments));
    },
    create: function create() {
        const value = Object.create.apply(Object, arguments);
        const proxy = new Proxy(value, StateObjectProxyHandler);
        Object.defineProperty(value, sym_ders, { value: { __proto__: null } });
        Object.defineProperty(value, sym_tracked, { value: proxy });
        return proxy;
    },
    groupBy: function groupBy() {
        return track(Object.groupBy.apply(Object, arguments));
    },
});

StateObject.prototype = Object.prototype;

/** @type {ProxyHandler} */
const StateObjectProxyHandler = {
    //apply(target, thisArg, argArray) {
    //    return Reflect.apply(target, thisArg, argArray);
    //},
    //construct(target, thisArg, argArray) {
    //    return Reflect.construct(target, thisArg, argArray);
    //},
    defineProperty(target, property, attributes) {
        const result = Reflect.defineProperty(target, property, attributes);
        if (result && typeof property == "string") {
            if ("value" in attributes) attributes.value = track(attributes.value);
            stateObjectInvalidate(target, property); // TODO! check if the property really did change
        }
        return result;
    },
    deleteProperty(target, p) {
        if (typeof p == "string" && p in target) {
            const result = Reflect.deleteProperty(target, p);
            if (result) stateObjectInvalidate(target, p);
            return result;
        } else {
            return Reflect.deleteProperty(target, p);
        }
    },
    get(target, p, receiver) {
        if (typeof p == "string") {
            const d = Reflect.getOwnPropertyDescriptor(target, p);
            if (d ? ("value" in d && (d.writable || d.configurable)) : Object.isExtensible(target)) {
                stateObjectUse(target, p);
            }
            // the line below fixes the problem outlined in the track function
            // it is commented out because it is called very often and may not justify the potential performance hit for fixing a very small edge case (string-keyed data properties frozen before the call to track)
            //return track(Reflect.get(target, p, receiver));
        }
        return Reflect.get(target, p, receiver);
    },
    getOwnPropertyDescriptor(target, p) {
        const d = Reflect.getOwnPropertyDescriptor(target, p);
        if (typeof p == "string" && (d ? ("value" in d && (d.writable || d.configurable)) : Object.isExtensible(target))) {
            stateObjectUse(target, p);
        }
        return d;
    },
    // getPrototypeOf(target) {
    //     return Reflect.getPrototypeOf(target);
    // },
    has(target, p) {
        if (typeof p == "string") stateObjectUse(target, p);
        return Reflect.has(target, p);
    },
    // isExtensible(target) {
    //     return Reflect.isExtensible(target);
    // },
    ownKeys(target) {
        stateObjectUse(target, sym_all);
        return Reflect.ownKeys(target);
    },
    // preventExtensions(target) {
    //     return Reflect.preventExtensions(target);
    // },
    set(target, p, newValue, receiver) {
        if (typeof p == "string") newValue = track(newValue);
        const result = Reflect.set(target, p, newValue, target);
        if (typeof p == "string") stateObjectInvalidate(target, p); // TODO! check if a value property really did change
        return result;
    },
    // setPrototypeOf(target, v) {
    //     return Reflect.setPrototypeOf(target, v);
    // },
};

/** @param {string} key */
function stateObjectInvalidate(target, key) {
    /** @type {Record<string | sym_all, Set<WeakRef<Derived>>>} */
    const ders = target[sym_ders];
    invalidateDerivationSet(ders[key]);
    invalidateDerivationSet(ders[sym_all]);
}

/** @param {string | sym_all} key */
function stateObjectUse(target, key) {
    if (!prepareUseTracked()) return;
    /** @type {Record<string | sym_all, Set<WeakRef<Derived>>>} */
    const ders = target[sym_ders];
    let set = ders[key];
    if (!set) ders[key] = set = new Set();
    set.add(current_derived);
}

//#endregion
//#region state array

// #region Overview
/*
[mutation types]
splice
reverse (reorder)
sort (reorder)
$move (reorder)
$purge
$transform

[mutates array]
copyWithin ($move + splice)
$assign, $remove, {member setter}, {length setter}, pop, push, shift, unshift, fill, splice, (equivalent to a splice)
reverse (reverse)
sort (sort)
$move ($move)
$keep, $purge, $take (equivalent to a $purge)
$transform ($transform)

[returns array]
concat
filter
flat
flatMap
map
slice
toReversed
toSorted
toSpliced
with

[returns boolean]
every
includes
some

[returns value]
at
find
findIndex
findLast
findLastIndex
indexOf
lastIndexOf

[cant optimize, reads whole array]
forEach
values
entries
toString
toLocaleString
join
reduce
reduceRight

[reads length]
keys
*/
// #endregion

function StateArray() {
    const value = Reflect.construct(Array, arguments, new.target || StateArray);
    const proxy = new Proxy(value, StateArrayProxyHandler);
    const length = value.length || 0;
    Object.defineProperty(value, sym_ders, { value: Array(length) });
    Object.defineProperty(value, sym_ders_slots, { value: Array(length) });
    Object.defineProperty(value, sym_slots, { value: Array(length) });
    Object.defineProperty(value, sym_len, { value: new Set() });
    Object.defineProperty(value, sym_all, { value: new Set() });
    Object.defineProperty(value, sym_value, { value });
    Object.defineProperty(value, sym_tracked, { value: proxy });
    return proxy;
}

defineProperties(StateArray, {
    [Symbol.hasInstance]: function isStateArray(target) {
        return Array.isArray(target) && sym_tracked in target;
    },
    use(target) {
        if (!target || typeof target !== "object" || !Array.isArray(target)) throw new TypeError("target is not an Array");
        if (!prepareUseTracked() || !(sym_len in target)) return;
        while (sym_src in target) target = target[sym_src];
        target[sym_all].add(current_derived);
    },
    from: function from() {
        return track(Array.from.apply(Array, arguments));
    },
    of: function of() {
        return track(Array.of.apply(Array, arguments));
    },
});

const StateArrayPrototype = defineProperties({ __proto__: DerivedArrayPrototype }, {
    constructor: StateArray,
    push() {
        const target = /** @type {StateArray} */ (this[sym_value]);
        if (arguments.length) {
            for (let i = 0; i < arguments.length; i++) {
                arguments[i] = track(arguments[i]);
            }
            Array.prototype.push.apply(target, arguments);
            const length = target.length;
            target[sym_ders].length = length;
            target[sym_ders_slots].length = length;
            target[sym_slots].length = length;
            invalidateDerivationSet(target[sym_len]);
            invalidateDerivationSet(target[sym_all]);
        }
        return target.length;
    },
    pop() {
        const target = /** @type {StateArray} */ (this[sym_value]);
        if (!target.length) return;
        const result = Array.prototype.pop.call(target);
        const length = target.length;
        target[sym_ders].length = length;
        target[sym_ders_slots].length = length;
        target[sym_slots].length = length;
        invalidateDerivationSet(target[sym_len]);
        invalidateDerivationSet(target[sym_all]);
        return result;
    },
    unshift() {
        const target = /** @type {StateArray} */ (this[sym_value]);
        if (arguments.length) {
            for (let i = 0; i < arguments.length; i++) {
                arguments[i] = track(arguments[i]);
            }
            Array.prototype.unshift.apply(target, arguments);
            const args = Array(arguments.length);
            Array.prototype.unshift.apply(target[sym_ders], args);
            Array.prototype.unshift.apply(target[sym_ders_slots], args);
            Array.prototype.unshift.apply(target[sym_slots], args);
            invalidateDerivationList(target[sym_ders]);
            invalidateDerivationSet(target[sym_len]);
            invalidateDerivationSet(target[sym_all]);
        }
        return target.length;
    },
    shift() {
        const target = /** @type {StateArray} */ (this[sym_value]);
        if (!target.length) return;
        const result = Array.prototype.shift.call(target);
        const last = target[sym_ders].pop();
        const first = target[sym_ders_slots].shift();
        target[sym_slots].shift();
        invalidateDerivationList(target[sym_ders]);
        invalidateDerivationSet(last);
        invalidateDerivationSet(first);
        invalidateDerivationSet(target[sym_len]);
        invalidateDerivationSet(target[sym_all]);
        return result;
    },
    splice() {
        const target = /** @type {StateArray} */ (this[sym_value]);
        const length = target.length;
        if (arguments.length >= 2) {
            for (let i = 2; i < arguments.length; i++) {
                arguments[i] = track(arguments[i]);
            }
            const start = arguments[0] = normalize_start(arguments[0], length);
            const deleteCount = arguments[1] = normalize_length(arguments[1], length - start);
            const delta = arguments.length - deleteCount - 2;
            const result = Array.prototype.splice.apply(target, arguments);
            // TAG1: should mutations set sym_slots with new symbols? (by clearing the slots)
            for (let i = start; i < start + deleteCount; i++) {
                invalidateDerivationSet(target[sym_ders][i]);
                invalidateDerivationSet(target[sym_ders_slots][i]);
                delete target[sym_ders_slots][i];
            }
            if (delta != 0) {
                for (let i = start + deleteCount; i < length; i++) {
                    invalidateDerivationSet(target[sym_ders][i]);
                }
                target[sym_ders].length += delta;
                if (delta > 0) {
                    const empty_slots = Array(delta);
                    empty_slots.unshift(start, 0);
                    Array.prototype.splice.apply(target[sym_ders_slots], empty_slots);
                    Array.prototype.splice.apply(target[sym_slots], empty_slots);
                } else {
                    target[sym_ders_slots].splice(start, -delta);
                    target[sym_slots].splice(start, -delta);
                }
                invalidateDerivationSet(target[sym_len]);
            }
            invalidateDerivationSet(target[sym_all]);
            return result;
        } else if (arguments.length == 1) {
            const start = arguments[0] = normalize_start(arguments[0], length);
            if (start >= length) {
                return Array.prototype.splice.call(target, start);
            }
            const ders = target[sym_ders].splice(new_length);
            const slots = target[sym_ders_slots].splice(new_length);
            target[sym_slots].length = new_length;
            target.length = new_length;
            const result = Array.prototype.splice.call(target, start);
            invalidateDerivationList(ders);
            invalidateDerivationList(slots);
            invalidateDerivationSet(target[sym_len]);
            invalidateDerivationSet(target[sym_all]);
            return result;
        }
        return Array.prototype.splice.call(target);
    },
    sort(callback) {
        const target = /** @type {StateArray} */ (this[sym_value]);
        const length = target.length;
        if (length < 2) return this;
        callback = callback || default_sort;
        const map = Array(length);
        for (let i = 0; i < length; i++) map[i] = i;
        map.sort((a, b) => callback(target[a], target[b]));
        let any = false;
        for (let i = 0; i < length; i++) {
            if (map[i] != i) {
                any = true;
                invalidateDerivationSet(target[sym_ders][i]);
            }
        }
        if (any) {
            const copy = Array.from(target);
            const copy_ders_slots = Array.from(target[sym_ders_slots]);
            const copy_slots = Array.from(target[sym_slots]);
            for (let i = 0; i < length; i++) {
                const ii = map[i];
                target[i] = copy[ii];
                target[sym_ders_slots][i] = copy_ders_slots[ii];
                target[sym_slots][i] = copy_slots[ii];
            }
            invalidateDerivationSet(target[sym_all]);
        }
        return this;
    },
    reverse() {
        const target = /** @type {StateArray} */ (this[sym_value]);
        Array.prototype.reverse.call(target);
        target[sym_ders_slots].reverse();
        target[sym_slots].reverse();
        invalidateDerivationList(target[sym_ders]);
        invalidateDerivationSet(target[sym_len]);
        invalidateDerivationSet(target[sym_all]);
        return this;
    },
    copyWithin(dest, src, src_end) {
        const target = /** @type {StateArray} */ (this[sym_value]);
        const length = target.length;
        if (!length) return this;
        dest = normalize_start(dest, length);
        src = normalize_start(src, length);
        if (dest == src) return this;
        src_end = normalize_end(src_end, length);
        let dest_end = dest + src_end - src;
        dest_end = dest_end < length ? dest_end : length;
        // TAG1: should mutations set sym_slots with new symbols? (by clearing the slots)
        for (let i = dest; i < dest_end; i++) {
            invalidateDerivationSet(target[sym_ders][i]);
            invalidateDerivationSet(target[sym_ders_slots][i]);
            delete target[sym_ders_slots][i];
        }
        return this;
    },
    fill(value, start, end) {
        const target = /** @type {StateArray} */ (this[sym_value]);
        const length = target.length;
        if (!length) return this;
        start = normalize_start(start, length);
        end = normalize_end(end, length);
        // TAG1: should mutations set sym_slots with new symbols? (by clearing the slots)
        for (let i = start; i < end; i++) {
            invalidateDerivationSet(target[sym_ders][i]);
            invalidateDerivationSet(target[sym_ders_slots][i]);
            delete target[sym_ders_slots][i];
        }
        return this;
    },

    $slot(index) {
        const i = as_index(index);
        if (i === undefined) throw new RangeError("argument is not a valid index: " + index);
        const target = /** @type {StateArray} */ (this[sym_value]);
        const slots = target[sym_slots];
        if (prepareUseTracked()) {
            if (i < target.length) {
                const slots = target[sym_ders_slots];
                let set = slots[i];
                if (!set) slots[i] = set = new Set();
                set.add(current_derived);
                return slots[i] || (slots[i] = Symbol());
            } else {
                target[sym_len].add(current_derived);
            }
        } else {
            if (i < target.length) {
                return slots[i] || (slots[i] = Symbol());
            }
        }
    },
    $slots() {
        const target = /** @type {StateArray} */ (this[sym_value]);
        if (prepareUseTracked()) {
            target[sym_all].add(current_derived);
        }
        const length = target.length;
        const slots = target[sym_slots];
        for (let i = 0; i < length; i++) {
            if (!slots[i]) slots[i] = Symbol();
        }
        return Array.from(slots);
    },
    $slotValue(index) {
        if (typeof index != "symbol") throw new TypeError("argument is not a symbol");
        const target = /** @type {StateArray} */ (this[sym_value]);
        const i = target[sym_slots].indexOf(index);
        if (i == -1) return sym_empty;
        if (prepareUseTracked()) {
            const slots = target[sym_ders_slots];
            let set = slots[i];
            if (!set) slots[i] = set = new Set();
            set.add(current_derived);
        }
        return target[i];
    },
    $slotExists(index) {
        if (typeof index != "symbol") throw new TypeError("argument is not a symbol");
        const target = /** @type {StateArray} */ (this[sym_value]);
        const i = target[sym_slots].indexOf(index);
        if (i == -1) return false;
        if (prepareUseTracked()) {
            const slots = target[sym_ders_slots];
            let set = slots[i];
            if (!set) slots[i] = set = new Set();
            set.add(current_derived);
        }
        return true;
    },
    $use() {
        if (prepareUseTracked()) {
            this[sym_value][sym_all].add(current_derived);
        }
    },

    $map(derivator, thisArg) {
        // TODO! optimize $map for the state array or remove this method to let it come from the parent prototype
        return DerivedArrayPrototype.$map.call(this, derivator, thisArg);
    },
});

StateArray.prototype = StateArrayPrototype;

/** @type {ProxyHandler<StateArray>} */
const StateArrayProxyHandler = {
    //apply(target, thisArg, argArray) {
    //    return Reflect.apply(target, thisArg, argArray);
    //},
    //construct(target, thisArg, argArray) {
    //    return Reflect.construct(target, thisArg, argArray);
    //},
    defineProperty(target, property, attributes) {
        if (property === "length") {
            if (!("value" in attributes)) throw new Error("cannot define length as a access property");
            const new_length = as_length(attributes.value);
            if (new_length === undefined) throw new Error("invalid length value");
            const old_length = target.length;
            if (new_length > old_length) {
                target.length = new_length;
                target[sym_ders].length = new_length;
                target[sym_ders_slots].length = new_length;
                const result = Reflect.defineProperty(target, property, attributes);
                invalidateDerivationSet(target[sym_len]);
                invalidateDerivationSet(target[sym_all]);
                return result;
            } else if (new_length < old_length) {
                const ders = target[sym_ders].slice(new_length);
                const slots = target[sym_ders_slots].slice(new_length);
                target.length = new_length;
                target[sym_ders].length = new_length;
                target[sym_ders_slots].length = new_length;
                const result = Reflect.defineProperty(target, property, attributes);
                invalidateDerivationList(ders);
                invalidateDerivationList(slots);
                invalidateDerivationSet(target[sym_len]);
                invalidateDerivationSet(target[sym_all]);
                return result;
            } else {
                return Reflect.defineProperty(target, property, attributes);
            }
        }
        const index = as_index(property);
        if (index !== undefined) {
            if (!("value" in attributes)) throw new Error("cannot define an item as a access property");
            attributes.value = track(attributes.value);
            let length_updated = false;
            if (target.length <= index) {
                target.length = index + 1;
                target[sym_ders].length = index + 1;
                target[sym_ders_slots].length = index + 1;
                length_updated = true;
            }
            const result = Reflect.defineProperty(target, property, attributes);
            // TAG1: should mutations set sym_slots with new symbols? (by clearing the slots)
            invalidateDerivationSet(target[sym_ders][index]);
            invalidateDerivationSet(target[sym_ders_slots][index]);
            if (length_updated) invalidateDerivationSet(target[sym_len]);
            invalidateDerivationSet(target[sym_all]);
            return result;
        }
        return Reflect.defineProperty(target, property, attributes);
    },
    deleteProperty(target, p) {
        if (p === "length") {
            throw new Error("cannot delete length property");
        }
        const index = as_index(p);
        if (index !== undefined && index < target.length) {
            const result = Reflect.deleteProperty(target, p);
            invalidateDerivationSet(target[sym_ders][index]);
            invalidateDerivationSet(target[sym_ders_slots][index]);
            invalidateDerivationSet(target[sym_all]);
            return result;
        }
        return Reflect.deleteProperty(target, p);
    },
    get(target, p, receiver) {
        stateArrayUseProp(target, p);
        return Reflect.get(target, p, receiver);
    },
    getOwnPropertyDescriptor(target, p) {
        stateArrayUseProp(target, p);
        return Reflect.getOwnPropertyDescriptor(target, p);
    },
    // getPrototypeOf(target) {
    //     return Reflect.getPrototypeOf(target);
    // },
    has(target, p) {
        stateArrayUseProp(target, p);
        return Reflect.has(target, p);
    },
    // isExtensible(target) {
    //     return Reflect.isExtensible(target);
    // },
    ownKeys(target) {
        if (prepareUseTracked()) {
            target[sym_all].add(current_derived);
        }
        return Reflect.ownKeys(target);
    },
    // preventExtensions(target) {
    //     return Reflect.preventExtensions(target);
    // },
    set(target, p, newValue) {
        if (p === "length") {
            const new_length = as_length(newValue);
            if (new_length === undefined) throw new Error("invalid length value");
            const old_length = target.length;
            if (new_length > old_length) {
                target.length = new_length;
                target[sym_ders].length = new_length;
                target[sym_ders_slots].length = new_length;
                const result = Reflect.set(target, p, newValue, target);
                invalidateDerivationSet(target[sym_len]);
                invalidateDerivationSet(target[sym_all]);
                return result;
            } else if (new_length < old_length) {
                const ders = target[sym_ders].splice(new_length);
                const slots = target[sym_ders_slots].splice(new_length);
                target.length = new_length;
                const result = Reflect.set(target, p, newValue, target);
                invalidateDerivationList(ders);
                invalidateDerivationList(slots);
                invalidateDerivationSet(target[sym_len]);
                invalidateDerivationSet(target[sym_all]);
                return result;
            } else {
                return Reflect.set(target, p, newValue, target);
            }
        }
        const index = as_index(p);
        if (index !== undefined) {
            newValue = track(newValue);
            let length_updated = false;
            if (target.length <= index) {
                target.length = index + 1;
                target[sym_ders].length = index + 1;
                target[sym_ders_slots].length = index + 1;
                length_updated = true;
            }
            const result = Reflect.set(target, p, newValue, target);
            // TAG1: should mutations set sym_slots with new symbols? (by clearing the slots)
            invalidateDerivationSet(target[sym_ders][index]);
            invalidateDerivationSet(target[sym_ders_slots][index]);
            if (length_updated) invalidateDerivationSet(target[sym_len]);
            invalidateDerivationSet(target[sym_all]);
            return result;
        }
        return Reflect.set(target, p, newValue, target);
    },
    // setPrototypeOf(target, v) {
    //     return Reflect.setPrototypeOf(target, v);
    // },
};

/** @param {StateArray} target @param {string | symbol} prop   */
function stateArrayUseProp(target, prop) {
    if (current_derived === null) return;
    if (prop === "length") {
        if (prepareUseTracked()) {
            target[sym_len].add(current_derived);
        }
        return;
    }
    const index = as_index(prop);
    if (index === undefined || !prepareUseTracked()) return;
    const length = target.length;
    if (index < length) {
        let set;

        const ders = target[sym_ders];
        set = ders[index];
        if (!set) ders[index] = set = new Set();
        set.add(current_derived);

        const slots = target[sym_ders_slots];
        set = slots[index];
        if (!set) slots[index] = set = new Set();
        set.add(current_derived);
    } else {
        target[sym_len].add(current_derived);
    }
}

//#region array helper functions
function normalize_length(length, max) {
    length = Math.trunc(+length);
    if (Number.isNaN(length)) return 0;
    if (length < 0) return 0;
    if (length > max) return max;
    return length;
}
function normalize_start(start, length) {
    start = Math.trunc(+start);
    if (Number.isNaN(start)) return 0;
    if (start < 0) start += length;
    if (start < 0) return 0;
    if (start >= length) return length;
    return start;
}
function normalize_end(end, length) {
    end = Math.trunc(+end);
    if (Number.isNaN(end)) return 0;
    if (end < 0) end += length;
    if (end <= 0) return 0;
    if (end > length) return length;
    return end;
}
function default_sort(x, y) {
    // http://www.ecma-international.org/ecma-262/6.0/#sec-sortcompare
    const xu = x === void 0;
    const yu = y === void 0;
    if (xu || yu) return xu - yu;
    x = "" + x;
    y = "" + y;
    if (x === y) return 0;
    if (x > y) return 1;
    return -1;
}
function as_index(key) {
    if (typeof key == "string") {
        const int = +key;
        if ("" + int === key) key = int;
    }
    if (typeof key == "number" && key >= 0 && key <= 0xFFFFFFFE && Number.isInteger(key)) return key;
    return undefined;
}
function as_length(key) {
    if (typeof key == "string") {
        const int = +key;
        if ("" + int === key) key = int;
    }
    if (typeof key == "number" && key >= 0 && key <= 0xFFFFFFFF && Number.isInteger(key)) return key;
    return undefined;
}
//#endregion

//#endregion
//#region state map

const nativeMapSizeGetter = Object.getOwnPropertyDescriptor(Map.prototype, "size").get;

const StateMapPrototype = defineProperties({ __proto__: Map.prototype }, {
    // read-one
    get(key) {
        /** @type {Map<any, Set<WeakRef<Derived>>>} */
        const ders = this[sym_ders];
        if (prepareUseTracked()) {
            let der_set = ders.get(key);
            if (!der_set) ders.set(key, der_set = new Set());
            der_set.add(current_derived);
        }
        return Map.prototype.get.apply(this, arguments);
    },
    has(key) {
        // TODO! split sym_ders into two to track presence of key and value of key separately
        /** @type {Map<any, Set<WeakRef<Derived>>>} */
        const ders = this[sym_ders];
        if (prepareUseTracked()) {
            let der_set = ders.get(key);
            if (!der_set) ders.set(key, der_set = new Set());
            der_set.add(current_derived);
        }
        return Map.prototype.has.apply(this, arguments);
    },
    // read-all
    entries() {
        if (prepareUseTracked()) {
            this[sym_all].add(current_derived);
        }
        return Map.prototype.entries.apply(this, arguments);
    },
    values() {
        if (prepareUseTracked()) {
            this[sym_all].add(current_derived);
        }
        return Map.prototype.values.apply(this, arguments);
    },
    keys() {
        if (prepareUseTracked()) {
            this[sym_all].add(current_derived);
        }
        return Map.prototype.keys.apply(this, arguments);
    },
    forEach() {
        if (prepareUseTracked()) {
            this[sym_all].add(current_derived);
        }
        return Map.prototype.forEach.apply(this, arguments);
    },
    // write-one
    set(key, value) {
        if (value === undefined) {
            if (Map.prototype.has.call(this, key) && Map.prototype.get.call(this, key) === undefined) {
                return this;
            }
        } else {
            value = track(value);
            if (is(value, Map.prototype.get.call(this, key))) return this;
        }
        const ders_set = this[sym_ders].get(key);
        if (ders_set) {
            this[sym_ders].delete(key);
            invalidateDerivationSet(ders_set);
        }
        invalidateDerivationSet(this[sym_len]);
        invalidateDerivationSet(this[sym_all]);
        Map.prototype.set.call(this, key, value);
        return this;
    },
    delete(key) {
        if (Map.prototype.delete.call(this, key)) {
            const ders_set = this[sym_ders].get(key);
            if (ders_set) {
                this[sym_ders].delete(key);
                invalidateDerivationSet(ders_set);
            }
            invalidateDerivationSet(this[sym_len]);
            invalidateDerivationSet(this[sym_all]);
            return true;
        }
        return false;
    },
    // write-all
    clear() {
        if (!nativeMapSizeGetter.call(this)) return;
        /** @type {Set<WeakRef<Derived>>[]} */
        const ders = Array.from(this[sym_ders].values());
        this[sym_ders].clear();
        invalidateDerivationList(ders);
        invalidateDerivationSet(this[sym_len]);
        invalidateDerivationSet(this[sym_all]);
        Map.prototype.clear.call(this);
    },
});

Object.defineProperty(StateMapPrototype, "size", {
    get() {
        if (prepareUseTracked()) {
            this[sym_len].add(current_derived);
        }
        return nativeMapSizeGetter.call(this);
    },
    enumerable: false,
    configurable: true,
});

function StateMap(iterable) {
    if (!new.target) throw new TypeError("Constructor StateMap requires 'new'");
    const value = new Map(iterable);
    Object.setPrototypeOf(value, new.target.prototype);
    Object.defineProperty(value, sym_ders, { value: new Map() });
    Object.defineProperty(value, sym_len, { value: new Set() });
    Object.defineProperty(value, sym_all, { value: new Set() });
    Object.defineProperty(value, sym_tracked, { value });
    return value;
}

StateMap.prototype = StateMapPrototype;

defineProperties(StateMap, {
    use(target) {
        if (!(target instanceof Map)) throw new TypeError("target is not a Map");
        if (prepareUseTracked()) {
            const all = target[sym_all];
            if (all) {
                all.add(current_derived);
            }
        }
    },
});

//#endregion
//#region state set

const nativeSetSizeGetter = Object.getOwnPropertyDescriptor(Set.prototype, "size").get;

const StateSetPrototype = defineProperties({ __proto__: Set.prototype }, {
    // read-one
    has(value) {
        /** @type {Map<any, Set<WeakRef<Derived>>>} */
        const ders = this[sym_ders];
        if (prepareUseTracked()) {
            let der_set = ders.get(value);
            if (!der_set) ders.set(value, der_set = new Set());
            der_set.add(current_derived);
        }
        return Set.prototype.has.call(this, value);
    },
    // read-all
    entries() {
        if (prepareUseTracked()) {
            this[sym_all].add(current_derived);
        }
        return Set.prototype.entries.call(this);
    },
    values() {
        if (prepareUseTracked()) {
            this[sym_all].add(current_derived);
        }
        return Set.prototype.values.call(this);
    },
    keys() {
        if (prepareUseTracked()) {
            this[sym_all].add(current_derived);
        }
        return Set.prototype.keys.call(this);
    },
    forEach() {
        if (prepareUseTracked()) {
            this[sym_all].add(current_derived);
        }
        return Set.prototype.forEach.apply(this, arguments);
    },
    // write-one
    add(value) {
        if (!Set.prototype.has.call(this, value)) {
            const ders_set = this[sym_ders].get(value);
            if (ders_set) {
                this[sym_ders].delete(value);
                invalidateDerivationSet(ders_set);
            }
            invalidateDerivationSet(this[sym_all]);
            Set.prototype.add.call(this, value);
        }
        return this;
    },
    delete(value) {
        if (Set.prototype.delete.call(this, value)) {
            const ders_set = this[sym_ders].get(value);
            if (ders_set) {
                this[sym_ders].delete(value);
                invalidateDerivationSet(ders_set);
            }
            invalidateDerivationSet(this[sym_all]);
            return true;
        }
        return false;
    },
    // write-all
    clear() {
        if (!nativeSetSizeGetter.call(this)) return;
        /** @type {Set<WeakRef<Derived>>[]} */
        const ders = Array.from(this[sym_ders].values());
        this[sym_ders].clear();
        invalidateDerivationList(ders);
        invalidateDerivationSet(this[sym_all]);
        Set.prototype.clear.call(this);
    },
});

Object.defineProperty(StateSetPrototype, "size", {
    get() {
        if (prepareUseTracked()) {
            this[sym_all].add(current_derived);
        }
        return nativeSetSizeGetter.call(this);
    },
    enumerable: false,
    configurable: true,
});

function StateSet(iterable) {
    if (!new.target) throw new TypeError("Constructor StateSet requires 'new'");
    const value = new Set(iterable);
    Object.setPrototypeOf(value, new.target.prototype);
    Object.defineProperty(value, sym_ders, { value: new Map() });
    Object.defineProperty(value, sym_all, { value: new Set() });
    Object.defineProperty(value, sym_tracked, { value });
    return value;
}

StateSet.prototype = StateSetPrototype;

defineProperties(StateSet, {
    use(target) {
        if (!(target instanceof Set)) throw new TypeError("target is not a Set");
        if (prepareUseTracked()) {
            const all = target[sym_all];
            if (all) {
                all.add(current_derived);
            }
        }
    },
});

//#endregion
//#region state promise

function StatePromise(executor) {
    if (!new.target) throw new TypeError("Constructor StatePromise requires 'new'");
    return track(Reflect.construct(Promise, [executor], new.target));
}

StatePromise.prototype = Promise.prototype;
defineProperties(StatePromise, {
    [Symbol.hasInstance]: function isStatePromise(target) {
        return target instanceof Promise && sym_tracked in target;
    },
    use(target) {
        if (!(target instanceof Promise)) throw new TypeError("target is not a Promise");
        track(target);
        if (sym_resolved in target || sym_rejected in target) return;
        promiseUseSetBySymbol(target, sym_ders_resolved);
        promiseUseSetBySymbol(target, sym_ders_rejected);
        Promise.any
    },
    resolve(value) {
        const promise = Promise.resolve(value);
        Object.defineProperty(promise, sym_tracked, { value: promise });
        Object.defineProperty(promise, sym_resolved, { value });
        return promise;
    },
    reject(value) {
        const promise = Promise.reject(value);
        Object.defineProperty(promise, sym_tracked, { value: promise });
        Object.defineProperty(promise, sym_rejected, { value });
        return promise;
    },
    race: function race() {
        return track(Promise.race.apply(Promise, arguments));
    },
    all: function all() {
        return track(Promise.all.apply(Promise, arguments));
    },
    allSettled: function allSettled() {
        return track(Promise.allSettled.apply(Promise, arguments));
    },
    any: function any() {
        return track(Promise.any.apply(Promise, arguments));
    },
    withResolvers: function withResolvers() {
        if (Promise.withResolvers) {
            const obj = Promise.withResolvers();
            track(obj.promise);
            return obj;
        }
        let f, r;
        const p = new Promise((resolve, reject) => { f = resolve; r = reject; });
        if (!f || !r) throw new Error("StatePromise.withResolvers polyfill failed because the Promise constructor did not run the executor synchronously");
        return {
            promise: track(p),
            resolve: f,
            reject: r,
        };
    },
});

//#endregion
//#region state date

function StateDate() {
    if (!new.target) throw new TypeError("Constructor StateDate requires 'new'");
    const value = Reflect.construct(Date, arguments, new.target);
    Object.defineProperty(value, sym_ders, { value: new Set() });
    Object.defineProperty(value, sym_tracked, { value });
    return value;
}

const StateDatePrototype = { __proto__: DerivedDatePrototype };

StateDate.prototype = StateDatePrototype;

//#endregion
//#region state & derived date methods

(function () {
    /** @type {(string | symbol)[]} */
    const read_methods = "toString,toDateString,toTimeString,toLocaleString,toLocaleDateString,toLocaleTimeString,valueOf,getTime,getFullYear,getUTCFullYear,getMonth,getUTCMonth,getDate,getUTCDate,getDay,getUTCDay,getHours,getUTCHours,getMinutes,getUTCMinutes,getSeconds,getUTCSeconds,getMilliseconds,getUTCMilliseconds,getTimezoneOffset,toUTCString,toISOString,toJSON".split(',');
    const write_methods = "setTime,setMilliseconds,setUTCMilliseconds,setSeconds,setUTCSeconds,setMinutes,setUTCMinutes,setHours,setUTCHours,setDate,setUTCDate,setMonth,setUTCMonth,setFullYear,setUTCFullYear".split(',');
    read_methods.unshift(Symbol.toPrimitive);
    for (let i = 0; i < read_methods.length; i++) {
        const name = read_methods[i];
        const method = Date.prototype[name];
        Object.defineProperty(StateDatePrototype, name, {
            value: {
                [name]() {
                    if (prepareUseTracked()) this[sym_ders].add(current_derived);
                    return method.apply(this, arguments);
                }
            }[name],
            writable: true,
            configurable: true,
        });
        Object.defineProperty(DerivedDatePrototype, name, {
            value: {
                [name]() {
                    const time = this[sym_handler]();
                    if (typeof time != "number") {
                        Date.prototype.setTime.call(this, 0 / 0);
                        throw new TypeError("DerivedDate proxy did not return a number");
                    }
                    Date.prototype.setTime.call(this, time);
                    return method.apply(this, arguments);
                }
            }[name],
            writable: true,
            configurable: true,
        });
    }
    for (let i = 0; i < write_methods.length; i++) {
        const name = write_methods[i];
        const method = Date.prototype[name];
        Object.defineProperty(StateDatePrototype, name, {
            value: {
                [name]() {
                    invalidateDerivationSet(this[sym_ders]);
                    return method.apply(this, arguments);
                }
            }[name],
            writable: true,
            configurable: true,
        });
        Object.defineProperty(DerivedDatePrototype, name, {
            value: {
                [name]() {
                    mutationOnDerivedDate();
                }
            }[name],
            writable: true,
            configurable: true,
        });
    }
}());

//#endregion
//#region array extensions

defineProperties(Array.prototype, {
    $slot() { },
    $slots() { return Array(this.length); },
    $slotValue() { return sym_empty; },
    $slotExists() { return false; },
    $use() { },
    $map(derivator, thisArg) {
        return this.map(callbackfn, thisArg);
        function callbackfn(value, number, array) {
            return derivator(value, Derived.from(number), array);
        }
    },
});

//#endregion
//#region promise extensions

defineProperties(Promise.prototype, {
    $resolved() {
        if (sym_resolved in this) return true;
        if (!(sym_rejected in this)) promiseUseSetBySymbol(this, sym_ders_resolved);
        return false;
    },
    $rejected() {
        if (sym_rejected in this) return true;
        if (!(sym_resolved in this)) promiseUseSetBySymbol(this, sym_ders_rejected);
        return false;
    },
    $settled() {
        if (sym_resolved in this || sym_rejected in this) return true;
        promiseUseSetBySymbol(this, sym_ders_resolved);
        promiseUseSetBySymbol(this, sym_ders_rejected);
        return false;
    },
    $now() {
        if (sym_resolved in this) return this[sym_resolved];
        if (sym_rejected in this) throw this[sym_rejected];
        promiseUseSetBySymbol(this, sym_ders_resolved);
        promiseUseSetBySymbol(this, sym_ders_rejected);
    },
});

Object.defineProperty(Promise.prototype, "$value", {
    get: function $value() {
        if (sym_resolved in this) return this[sym_resolved];
        if (!(sym_rejected in this)) promiseUseSetBySymbol(this, sym_ders_resolved);
    },
    enumerable: false,
    configurable: true,
});

Object.defineProperty(Promise.prototype, "$error", {
    get: function $error() {
        if (sym_rejected in this) return this[sym_rejected];
        if (!(sym_resolved in this)) promiseUseSetBySymbol(this, sym_ders_rejected);
    },
    enumerable: false,
    configurable: true,
});

function promiseUseSetBySymbol(promise, sym) {
    if (prepareUseTracked()) {
        let set = promise[sym];
        if (!set) {
            set = new Set();
            Object.defineProperty(track(promise), sym, {
                value: set,
                writable: false,
                enumerable: false,
                configurable: true,
            });
        }
        set.add(current_derived);
    } else {
        track(promise);
    }
}

//#endregion
//#region date extensions

defineProperties(Date.prototype, {
    $isPast() {
        const time = this.getTime();
        return Date.now() >= time || !!invalidateThen(time);
    },
    $isFuture() {
        const time = this.getTime();
        return Date.now() < time && !invalidateThen(time);
    },
});

//#endregion
//#region error extensions

defineProperties(Error, {
    $stack(omitFrames) {
        if (typeof omitFrames !== "number") throw new TypeError("argument must be a number");
        if (omitFrames < 0) throw new TypeError("argument must be non-negative");
        omitFrames += 2; // remove the Error line and the $stack line
        if (!Number.isSafeInteger(omitFrames)) throw new TypeError("argument must be an integer");

        const e = Error();
        console.log(e.stack);
        addSchedulerStack(e, current_scheduler_stack);
        console.log(e.stack);
        let stack = e.stack;
        if (typeof stack != "string" || !stack) return;

        let position = 0;
        for (let i = 0; i < omitFrames; i++) {
            const nextNewline = stack.indexOf("\n", position);
            if (nextNewline === -1) {
                // Not enough lines, return empty string
                return "";
            }
            position = nextNewline + 1; // Move past the newline
        }
        return "\n" + stack.slice(position);
    },
});

//#endregion
//#region Signal

/** @typedef {(...args: any[]) => void} SignalHandler */

/** a map from strong handlers to null and from weak references to the weakmap that keeps weak handlers alive (or rather associated to this signal)
 * @typedef {Map<SignalHandler | WeakRef<SignalHandler>, WeakMap<WeakKey, SignalHandler> | null>} SignalHandlers */

/** the weak map that stores the weakrefs of known handlers
 * @typedef {WeakMap<SignalHandler, WeakRef<SignalHandler>>} SignalWeakRefs */

/** @typedef {{[sym_handlers]: SignalHandlers, [sym_weakrefs]: SignalWeakRefs}} Signal */

const SignalPrototype = defineProperties({ __proto__: Function.prototype }, {
    constructor: Signal,
    try() {
        try {
            this.apply(null, arguments);
            return null;
        } catch (e) {
            return e;
        }
    },
    on() {
        if (arguments.length < 2) {
            throw new TypeError("Failed to call method 'on' 2 arguments required, but only " + arguments.length + " present");
        }
        signalAddWeakHandler(this, arguments);
        return this;
    },
    /** @this {Signal} @param {SignalHandler} handler */
    off(handler) {
        if (typeof handler != "function") throw new TypeError("handler is not a function");
        const weakrefs = this[sym_weakrefs];
        const weakref = weakrefs.get(handler);
        if (weakref) {
            // weak handler, delete it from the handlers and weakrefs
            this[sym_handlers].delete(weakref);
            weakrefs.delete(handler);
        } else {
            // strong handler, delete it just from the handlers
            this[sym_handlers].delete(handler);
        }
        return this;
    },
    /** @this {Signal} @param {SignalHandler} handler */
    persistent(handler) {
        if (typeof handler != "function") throw new TypeError("handler is not a function");
        const weakrefs = this[sym_weakrefs];
        const weakref = weakrefs.get(handler);
        if (weakref) {
            // if it is an existing weak handler, make it permanent by adding a reference on the weak map that won't ever broken
            this[sym_handlers].get(weakref).set(this, handler);
        } else {
            // otherwise just add it as a strong handler
            this[sym_handlers].set(handler, null);
        }
        return this;
    },
    weak() {
        signalAddWeakHandler(this, arguments.length == 1 ? arguments : [arguments[0]]);
        return this;
    },
});

function Signal() {
    if (!new.target) throw new TypeError("Constructor Signal requires 'new'");
    Object.setPrototypeOf(Signal, typeof new.target.prototype == "object" ? new.target.prototype : SignalPrototype);
    Object.defineProperty(Signal, sym_handlers, { value: new Map(), writable: false, enumerable: false, configurable: false });
    Object.defineProperty(Signal, sym_weakrefs, { value: new WeakMap(), writable: false, enumerable: false, configurable: false });
    return Signal;
    function Signal() {
        /** @type {SignalHandlers} */
        const handlers = Signal[sym_handlers];
        const copy = Array.from(handlers.keys());
        const length = copy.length;
        let errors = null;
        for (let i = 0; i < length; i++) {
            try {
                const weakref = copy[i];
                if (typeof weakref == "function") {
                    weakref.apply(null, arguments);
                } else {
                    const handler = weakref.deref();
                    if (!handler) {
                        handlers.delete(weakref);
                    } else {
                        handler.apply(null, arguments);
                    }
                }
            } catch (e) {
                if (errors) {
                    errors.push(e);
                } else {
                    errors = [e];
                }
            }
        }
        if (errors) throw new AggregateError(errors, "Signal handler failed");
    }
}

defineProperties(Signal, {
    null: Object.setPrototypeOf(function nopSignal() { }, defineProperties({ __proto__: SignalPrototype }, {
        try() { return null; },
        on() {
            const args = arguments;
            if (typeof args[args.length - 1] != "function") throw new TypeError("handler is not a function");
            for (let i = 0; i < args.length - 1; i++) {
                if (typeof args[i] != "object" && typeof args[i] != "symbol") {
                    throw new TypeError("Invalid value used as weak map key");
                }
            }
            return this;
        },
        off(handler) {
            if (typeof handler != "function") throw new TypeError("handler is not a function");
            return this;
        },
        persistent(handler) {
            if (typeof handler != "function") throw new TypeError("handler is not a function");
            return this;
        },
        weak(handler) {
            if (typeof handler != "function") throw new TypeError("handler is not a function");
            return this;
        },
    })),
});

Signal.prototype = SignalPrototype;

/** @param {Signal} signal @param {{[key: number]: any; length: number}} args */
function signalAddWeakHandler(signal, args) {
    const handler_index = args.length - 1;
    /** @type {SignalHandler} */
    const handler = args[handler_index];
    if (typeof handler != "function") throw new TypeError("handler is not a function");
    const handlers = signal[sym_handlers];
    const weakrefs = signal[sym_weakrefs];

    // if already a strong handler then nothing to do
    if (handlers.get(handler)) return;

    let weakmap;

    // initialize a weakref for it
    let weakref = weakrefs.get(handler);
    if (!weakref) {
        // weakref does not yet exist, then create it and add it to the handler map with the new weak map as the value
        weakrefs.set(handler, weakref = new WeakRef(handler));
        handlers.set(weakref, weakmap = new WeakMap());
    } else {
        // weakref already exists, get the existing weakmap
        weakmap = handlers.get(weakref);
    }

    // add the strong references to the weakmap
    for (let i = 0; i < handler_index; i++) {
        weakmap.set(args[i], handler);
    }
}

//#endregion

//#region async error stack

function queue(callback) {
    let stack = Error().stack;
    if (typeof stack == "string" && stack) {
        const index1 = stack.indexOf("\n"); // remove "Error:" line
        if (index1 != -1) {
            const index2 = stack.indexOf("\n", index1 + 1); // remove queueMicrotask2 call
            stack = stack.slice(index2 != -1 ? index2 : index1);
        }
        if (current_scheduler_stack) {
            const index = stack.lastIndexOf("\n", stack.length - 1); // remove callback call (we know it exists because current_scheduler_stack is set)
            if (index != -1) stack = stack.slice(0, index);
            stack += current_scheduler_stack;
        }
    } else {
        stack = "";
    }
    if (callback instanceof Promise) {
        if (stack) callback.catch(e => {
            addSchedulerStack(e, stack);
            throw e;
        });
    } else {
        queueMicrotask(!stack ? callback : {
            [callback.name]() {
                try {
                    current_scheduler_stack = stack;
                    const result = callback();
                    if (result instanceof Promise) {
                        result.catch(e => {
                            addSchedulerStack(e, stack);
                            throw e;
                        });
                    }
                } catch (e) {
                    addSchedulerStack(e, current_scheduler_stack);
                    throw e;
                } finally {
                    current_scheduler_stack = "";
                }
            }
        }[callback.name]);
    }
}

function addSchedulerStack(e, scheduler) {
    if (typeof e != "object" || !e || !scheduler) return;
    let scheduled = e.stack;
    if (typeof scheduled == "string") {
        const index = scheduled.lastIndexOf("\n", scheduled.length - 1); // remove callback call
        if (index != -1) scheduled = scheduled.slice(0, index);
        e.stack = scheduled + scheduler;
    }
}

//#endregion

module.exports = {
    __proto__: null,
    Derived,
    State,
    Effect,
    Signal,
};
