//@ts-nocheck
"use strict";

// TODO! replace creation of objects followed by `Object.setPrototypeOf` with `Reflect.construct`

//#region symbols

// TODO! organize the symbols and don't share them unless necessary

/** the derivations of this object (Derived objects that depend on this), present on all objects that can be depended on such as State and Derived
 *
 * on `State` and `Derived` this is always a `Set<WeakRef<Derived>>`
 *
 * on `StateObject` this is always a `Record<string | sym_all, Set<WeakRef<Derived>>>` with null prototype
 *
 * on `StateArray` this is always a `(Set<WeakRef<Derived>> | <empty>)[]` (each item represents the corresponding item in the real array by index, (shifting will invalidate later slots))
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

/** used by StateView and DerivedArray */
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
 *     [sym_slots]: Set<WeakRef<Derived>>[],
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
        const derived = this;
        return new Derived(function derive() {
            return derivator(derived());
        });
    },
    prop(key) {
        const derived = this;
        return new Derived(function prop() {
            return derived()[key];
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
    coalesce(else_) {
        const derived = this;
        return new Derived(function coalesce() {
            const value = derived();
            return value === null || value === undefined ? else_ : value;
        });
    },
    fmap(fmap) {
        const derived = this;
        return new Derived(function fmap() {
            const value = derived();
            return value === null || value === undefined ? value : fmap(value);
        });
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
            if (!derivator) return derived[sym_value];

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
                    return derived[sym_value];
                }
                pideps.clear();
            }
            const new_weak = new WeakRef(derived);
            const old_derived = current_derived;
            const old_derived_used = current_derived_used;
            current_derived = new_weak;
            const old_value = derived[sym_value];
            try {
                delete derived[sym_value];
                for (let i = 0; i < maximumDerivedRepeats; i++) {
                    derived[sym_weak] = new_weak;
                    current_derived_used = false;
                    let value = track(derivator());
                    while (derived[sym_weak] && value instanceof Derived) {
                        value = value();
                    }
                    if (derived[sym_weak]) {
                        if (!current_derived_used) derivator = null;
                        return derived[sym_value] = value;
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

Object.assign(Derived, {
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
    onUseDerivedOutsideOfDerivation: "allow",
    onUseTrackedOutsideOfDerivation: "allow",
})

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
                debugRegistry.register(target, Error("cleanup (type: " + typeof target + ") (name: " + target.name + ")").stack);
                //debugRegistry.register(ref, Error("cleanup (ref)").stack);
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
        const value = track(transformer(this[sym_value]));
        if (!is(this[sym_value], value)) {
            this[sym_value] = value;
            invalidateDerivationSet(this[sym_ders]);
        }
    },
});

const StateViewPrototype = defineProperties({ __proto__: StatePrototype }, {
    now() {
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
        const value = transformer(Derived.now(function () {
            return self[sym_target][self[sym_key]];
        }));
        this[sym_target][this[sym_key]] = value;
    },
});

const StateProxyPrototype = defineProperties({ __proto__: StatePrototype }, {
    now() {
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
        const value = Derived.now(function () {
            return self[sym_getter]();
        });
        this[sym_setter](transformer(value));
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
            return State[sym_value];
        }
    })[name];
    Object.setPrototypeOf(State, new.target.prototype);
    Object.defineProperty(State, sym_ders, { value: new Set() });
    State[sym_value] = track(value);
    return State;
}

Object.assign(State, {
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
                return State[sym_target][State[sym_key]];
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
                return State[sym_getter]();
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
})

State.prototype = StatePrototype;

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
            if (affect_task === null) queueMicrotask(this[sym_affect]);
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

Object.assign(Effect, {
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
    queueMicrotask(affect);
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
            queueMicrotask(target[sym_affect]);
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
    for (let i = 0; i < src.length; i++) {
        const derived = src[i].deref();
        /* istanbul ignore next */
        if (derived && derived[sym_weak] === src[i]) {
            invalidateDerivation(derived);
        }
    }
}
/** @param {Set<WeakRef<Derived>>[]} arr */
function invalidateDerivationList(arr) {
    for (let i = 0; i < arr.length; i++) {
        const set = arr[i];
        invalidateDerivationSet(set);
    }
}

//#endregion
//#region utils

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
    remainingFrozenComparisonsDepth = maximumFrozenComparisonsDepth;
    try {
        return isr(a, b);
    } catch {
        return false;
    }
}

function isr(a, b) {
    // TODO! check if it has the same getters and setters
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
                if ("value" in prop_a) {
                    const prop_b = descriptors_b[key_a];
                    if (!prop_b || !("value" in prop_b) || !isr(prop_a.value, prop_b.value)) {
                        return false;
                    }
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
            if ("value" in prop_a) {
                const prop_b = descriptors_b[key_a];
                if (!prop_b || !("value" in prop_b) || !isr(prop_a.value, prop_b.value)) {
                    remainingFrozenComparisonsDepth++;
                    return false;
                }
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
 * @param {T} target 
 * @param {import(".").Derived.Array.ProxyHandler<T, any>} handler 
 * @returns 
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
});

DerivedArray.prototype = DerivedArrayPrototype;

/** @type {import(".").Derived.Array.ProxyHandler<number, number>} */
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

/** @type {import(".").Derived.Array.ProxyHandler<import(".").Derived<any>, number>} */
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

/** @type {import(".").Derived.Array.ProxyHandler<(import(".").Derived<any> | undefined)[] & { fn: (index: number) => any }, any>} */
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

/** @type {import(".").Derived.Array.ProxyHandler<(import(".").Derived<any> | undefined)[] & { len: import(".").Derived<any>, fn: (index: number) => any }, any>} */
const derivedLengthMappedRangeArrayProxyHandler = {
    length(target) {
        return target.length = validate_length(target.len());
    },
    item(target, index) {
        if (index >= (target.length = validate_length(target.len()))) return sym_empty
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

Object.assign(DerivedArray, {
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

/** @type {ProxyHandler<StateArray>} */
const OldDerivedArrayProxyHandler = {
    defineProperty() { mutationOnDerivedArray(); },
    deleteProperty() { mutationOnDerivedArray(); },
    set() { mutationOnDerivedArray(); },
    setPrototypeOf() { mutationOnDerivedArray(); },
    preventExtensions() { mutationOnDerivedArray(); },
};

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
        console.log(Reflect.getOwnPropertyDescriptor(target, p));
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
//#region state object

// TODO! add static methods to constructors of state objects, arrays map set and promise

function StateObject() {
    const value = new.target ? this : {};
    const proxy = new Proxy(value, StateObjectProxyHandler);
    Object.defineProperty(value, sym_ders, { value: { __proto__: null } });
    Object.defineProperty(value, sym_tracked, { value: proxy });
    return proxy;
}

Object.defineProperty(StateObject, Symbol.hasInstance, {
    value: function isStateObject(target) {
        return target && typeof target == "object" && sym_tracked in target;
    },
    writable: true,
    enumerable: true,
    configurable: true,
});
Object.assign(StateObject, {
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
    Object.defineProperty(value, sym_slots, { value: Array(length) });
    Object.defineProperty(value, sym_len, { value: new Set() });
    Object.defineProperty(value, sym_all, { value: new Set() });
    Object.defineProperty(value, sym_value, { value });
    Object.defineProperty(value, sym_tracked, { value: proxy });
    return proxy;
}

Object.defineProperty(StateArray, Symbol.hasInstance, {
    value: function isStateArray(target) {
        return Array.isArray(target) && sym_tracked in target;
    },
    writable: true,
    enumerable: true,
    configurable: true,
});
Object.assign(StateArray, {
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
        const first = target[sym_slots].shift();
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
            for (let i = start; i < start + deleteCount; i++) {
                invalidateDerivationSet(target[sym_ders][i]);
                invalidateDerivationSet(target[sym_slots][i]);
                delete target[sym_slots][i];
            }
            if (delta != 0) {
                for (let i = start + deleteCount; i < length; i++) {
                    invalidateDerivationSet(target[sym_ders][i]);
                }
                target[sym_ders].length += delta;
                if (delta > 0) {
                    target[sym_slots].splice(start, start + deleteCount, ...Array(delta));
                } else {
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
            const slots = target[sym_slots].splice(new_length);
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
            const copy_slots = Array.from(target[sym_slots]);
            for (let i = 0; i < length; i++) {
                const ii = map[i];
                target[i] = copy[ii];
                target[sym_slots][i] = copy_slots[ii];
            }
            invalidateDerivationSet(target[sym_all]);
        }
        return this;
    },
    reverse() {
        const target = /** @type {StateArray} */ (this[sym_value]);
        Array.prototype.reverse.call(target);
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
        for (let i = dest; i < dest_end; i++) {
            invalidateDerivationSet(target[sym_ders][i]);
            invalidateDerivationSet(target[sym_slots][i]);
            delete target[sym_slots][i];
        }
        return this;
    },
    fill(value, start, end) {
        const target = /** @type {StateArray} */ (this[sym_value]);
        const length = target.length;
        if (!length) return this;
        start = normalize_start(start, length);
        end = normalize_end(end, length);
        for (let i = start; i < end; i++) {
            invalidateDerivationSet(target[sym_ders][i]);
            invalidateDerivationSet(target[sym_slots][i]);
            delete target[sym_slots][i];
        }
        return this;
    },

    $map(derivator, thisArg) {
        throw new Error("TODO! implement $map");
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
                target[sym_slots].length = new_length;
                const result = Reflect.defineProperty(target, property, attributes);
                invalidateDerivationSet(target[sym_len]);
                invalidateDerivationSet(target[sym_all]);
                return result;
            } else if (new_length < old_length) {
                const ders = target[sym_ders].slice(new_length);
                const slots = target[sym_slots].slice(new_length);
                target.length = new_length;
                target[sym_ders].length = new_length;
                target[sym_slots].length = new_length;
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
                target[sym_slots].length = index + 1;
                length_updated = true;
            }
            const result = Reflect.defineProperty(target, property, attributes);
            invalidateDerivationSet(target[sym_ders][index]);
            invalidateDerivationSet(target[sym_slots][index]);
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
            invalidateDerivationSet(target[sym_slots][index]);
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
                target[sym_slots].length = new_length;
                const result = Reflect.set(target, p, newValue, target);
                invalidateDerivationSet(target[sym_len]);
                invalidateDerivationSet(target[sym_all]);
                return result;
            } else if (new_length < old_length) {
                const ders = target[sym_ders].splice(new_length);
                const slots = target[sym_slots].splice(new_length);
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
                target[sym_slots].length = index + 1;
                length_updated = true;
            }
            const result = Reflect.set(target, p, newValue, target);
            invalidateDerivationSet(target[sym_ders][index]);
            invalidateDerivationSet(target[sym_slots][index]);
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

        const slots = target[sym_slots];
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
    if (iterable != null && iterable != undefined) {
        const value = new Map(iterable);
        Object.setPrototypeOf(value, new.target.prototype);
        Object.defineProperty(value, sym_ders, { value: new Map() });
        Object.defineProperty(value, sym_len, { value: new Set() });
        Object.defineProperty(value, sym_all, { value: new Set() });
        Object.defineProperty(value, sym_tracked, { value });
        return value;
    }
}

StateMap.prototype = StateMapPrototype;

Object.assign(StateMap, {
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
    if (iterable != null && iterable != undefined) {
        const value = new Set(iterable);
        Object.setPrototypeOf(value, new.target.prototype);
        Object.defineProperty(value, sym_ders, { value: new Set() });
        Object.defineProperty(value, sym_all, { value: new Set() });
        Object.defineProperty(value, sym_tracked, { value });
        return value;
    }
}

StateSet.prototype = StateSetPrototype;

Object.assign(StateSet, {
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
Object.defineProperty(StatePromise, Symbol.hasInstance, {
    value: function isStatePromise(target) {
        return target instanceof Promise && sym_tracked in target;
    },
    writable: true,
    enumerable: true,
    configurable: true,
});
Object.assign(StatePromise, {
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
//#region array extensions

defineProperties(Array.prototype, {
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

module.exports = {
    __proto__: null,
    Derived,
    State,
    Effect,
    Signal,
};
