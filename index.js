//@ts-nocheck
"use strict";
//#region symbols

/** the derivations of this object (Derived objects that depend on this), present on all objects that can be depended on such as State and Derived
 *
 * on `State` and `Derived` this is always a `Set<WeakRef<Derived>>`
 *
 * on `StateObject` this is always a `Record<string | sym_all, Set<WeakRef<Derived>>>` with null prototype
 *
 * on `StringArray` this is always a `(Set<WeakRef<Derived>> | <empty>)[]` (each item represents the corresponding item in the real array by index, (shifting will invalidate later slots))
 *
 * the value is `WeakRef<Derived>` and if it matches `.deref()[sym_weak]` that means the derivation is still active
 *
 * if it does not match, this weakref can be discarded, since it was from an outdated derivation */
const sym_ders = Symbol("ders");

/** the slot based derivations of this array, present on all `StringArray`
 *
 * unlike sym_ders, shifting will **not** invalidate later slots
 *
 * will be used by deriving functions that do not rely on the position of the element
 */
const sym_slots = Symbol("slots");

/** the derivations of the array's length, present on all `StringArray` */
const sym_len = Symbol("len");

/** the invalidated and possibly invalidated dependencies of this object, present only on Derived objects
 *
 * having a non empty set on this value means this Derived is possibly invalidated, it is possibly invalidated if any of the deriveds in this set are invalidated
 *
 * this is always a `Map<WeakRef<Derived>, any>`
 *
 * the key is `WeakRef<Derived>` unlike sym_ders, it does not matter if it matches `.deref()[sym_weak]`, the point here is just to have a weak reference to the dependend object
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

/** the value of this object, always exists on State, and exists on Derived unless it is being actively derived, has never being derived or is an affect
 *
 * also used by `StringArray` to store itself not wrapped in a proxy
 */
const sym_value = Symbol("value");

/** the derivator function of the derivator object, exists on Derived and on DerivedMapArray */
const sym_derivator = Symbol("derivator");

/** this symbol is present on active affector functions
 *
 * when those derivations are invalidated, a microtask is scheduled to automatically rerun the derivator
 *
 * the value is a boolean, and it is true when the microtask is scheduled, and false when not
 *
 * if it is true, setting it to false or unsetting it can also be used to cancel the pending task
 */
const sym_affect_task = Symbol("affect_task");

/** this symbol is present on active affector functions
 *
 * this contains a function that must be called whenever a dependency of the derivation possibly changes
 */
const sym_affect = Symbol("affect");

/** the set of references that are present in affectFunctionsWeakRefs */
const sym_affect_refs = Symbol("affect_refs");

/** a symbol present on tracked objects, the value is itself after tracking
 *
 * used to reobtain the proxied version of an object to avoid unecessary creation of duplicate proxies
 */
const sym_tracked = Symbol("tracked");

/** a symbol used by `StateObject[sym_ders]` when something depends on all string properties
 *
 * also used by `StringArray` to store derivations `Set<WeakRef<Derived>>` that need all values
 */
const sym_all = Symbol("all");

/** exists on DerivedMapArray, the array from which the map occours */
const sym_src = Symbol("src");

/** exists on DerivedMapArray */
const sym_cache = Symbol("cache");

/** used by StateView */
const sym_target = Symbol("target");

/** used by StateView */
const sym_key = Symbol("key");

/** used by StateProxy */
const sym_getter = Symbol("getter");

/** used by StateProxy */
const sym_setter = Symbol("setter");

//#endregion
//#region globals

/** @typedef {{ [sym_pideps]: Map<WeakRef<Derived>, any>, [sym_ders]: Set<WeakRef<Derived>>, [sym_weak]: WeakRef<Derived>, [sym_value]?: any }} Derived */
/** @typedef {any[] & { [sym_ders]: Set<WeakRef<Derived>>[], [sym_slots]: Set<WeakRef<Derived>>[], [sym_len]: Set<WeakRef<Derived>>, [sym_all]: Set<WeakRef<Derived>>, [sym_value]: StringArray, [sym_tracked]: StringArray }} StringArray */

/** if this value is set, it is the derived currently running at the top of the stack
 *
 * if it is null, it means we are outside a derived
 *
 * @type {Derived | null} */
let current_derived = null;

/** flag that is set everytime the derivation is used
 *
 * useful to detect when a derivation has no dependencies
 */
let current_derived_used = true;

/** this may be unecessary because circular derivation is already being detected, but i could not prove this */
const recursiveDerivationInvalidationGuard = new WeakSet();

/** a weak map of references that keep affect functions from being garbage collected
 *
 * @type {WeakMap<object | symbol, Set>} */
const affectFunctionsWeakRefs = new WeakMap();

/** a strong set of `"everything"` referenced that keep affect functions from being garbage collected
 *
 * @type {Set} */
const affectFunctionsRefs = new Set();

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
    then(derivator) {
        const derived = this;
        return new Derived(function then() {
            return derivator(derived());
        });
    }
});

function Derived(name, derivator) {
    if (!new.target) throw new TypeError("Constructor Derived requires 'new'");
    if (arguments.length == 1) {
        derivator = name;
        name = "State";
    }
    if (typeof derivator !== "function") throw new TypeError("Derivator is not a function");
    name = name === "State" ? derivator.name || name : "" + name;
    /** @type {Derived} */
    const Derived = ({
        [name]() {
            //if (current_derived === null) throw new Error("can't call a derived outside of a derivation, use the now method or call this inside a derivation");

            if (current_derived) {
                // add the current derivator as a derivation of myself
                Derived[sym_ders].add(current_derived[sym_weak]);
                current_derived_used = true;
            }

            if (Derived[sym_weak]) {
                if (!(sym_value in Derived)) {
                    // TODO! add information to help pin down the loop
                    throw new RangeError("Circular dependency between derives detected");
                }
                const pideps = Derived[sym_pideps];
                if (pideps.size == 0) return Derived[sym_value];
                const arr = Array.from(pideps.keys());
                const old_derived = current_derived;
                const old_derived_used = current_derived_used;
                let invalidated = false;
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
                        if (!Object.is(old_value, new_value)) {
                            invalidated = true;
                            break;
                        }
                    }
                } finally {
                    current_derived = old_derived;
                    current_derived_used = old_derived_used;
                }
                if (!invalidated) return Derived[sym_value];
                pideps.clear();
            }
            const old_derived = current_derived;
            const old_derived_used = current_derived_used;
            current_derived = Derived;
            const old_value = Derived[sym_value];
            const old_weak = Derived[sym_weak];
            try {
                delete Derived[sym_value];
                Derived[sym_weak] = new WeakRef(Derived);
                const value = track(derivator());
                return Derived[sym_value] = value;
            } catch (e) {
                Derived[sym_value] = old_value;
                Derived[sym_weak] = old_weak;
                throw e;
            } finally {
                current_derived = old_derived;
                current_derived_used = old_derived_used;
            }
        }
    })[name];
    Object.setPrototypeOf(Derived, typeof new.target.prototype == "object" ? new.target.prototype : DerivedPrototype);
    Object.defineProperty(Derived, sym_ders, { value: new Set() });
    Object.defineProperty(Derived, sym_pideps, { value: new Map() });
    Object.defineProperty(Derived, sym_weak, { writable: true, value: null });
    return Derived;
}

defineProperties(Derived, {
    now(derivator) {
        // if (current_derived !== null) throw new Error(current_derived
        //     ? "can't call method now inside of a derivation, call the derived or call the now method outside a derivation"
        //     : "can't call method now inside of another call to Derived.now, call the derived or call the now method outside a derivation");
        const old_derived = current_derived;
        const old_derived_used = current_derived_used;
        current_derived = null;
        try {
            return derivator();
        } finally {
            current_derived = old_derived;
            current_derived_used = old_derived_used;
        }
    },
    from(value) {
        if (value instanceof Derived) return value;
        value = track(value);
        const derived = function Derived() { return value; };
        Object.setPrototypeOf(derived, DerivedPrototype);
        Object.defineProperty(derived, sym_ders, { value: new Set() });
        Object.defineProperty(derived, sym_pideps, { value: new Map() });
        Object.defineProperty(derived, sym_weak, { value: new WeakRef(derived) });
        return derived;
    },
    use(value) {
        return value instanceof Derived ? value() : track(value);
    },
    affect,
})

Derived.prototype = DerivedPrototype;

//#endregion Derived
//#region State

const StatePrototype = defineProperties({ __proto__: DerivedPrototype }, {
    constructor: State,
    now() {
        //if (current_derived !== null) throw new Error("can't call method now inside of a derivation, call the state or call the now method outside a derivation");
        return this[sym_value];
    },
    set(value) {
        value = track(value);
        if (!Object.is(this[sym_value], value)) {
            this[sym_value] = value;
            invalidateDerivationSet(this[sym_ders]);
        }
    },
    mut(transformer) {
        if (typeof transformer != "function") throw new TypeError("transformer is not a function");
        const value = track(transformer(this[sym_value]));
        if (!Object.is(this[sym_value], value)) {
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
        name = "" + name;
    }
    const State = ({
        [name]() {
            //if (current_derived === null) throw new Error("can't call a state outside of a derivation, use the now method or call this inside a derivation");
            if (current_derived) {
                // add the current derivator as a derivation of myself
                State[sym_ders].add(current_derived[sym_weak]);
                current_derived_used = true;
            }
            return State[sym_value];
        }
    })[name];
    Object.setPrototypeOf(State, typeof new.target.prototype == "object" ? new.target.prototype : StatePrototype);
    Object.defineProperty(State, sym_ders, { value: new Set() });
    State[sym_value] = track(value);
    return State;
}

defineProperties(State, {
    track,
    view(name, target, key) {
        if (arguments.length == 2) {
            key = target;
            target = name;
            name = "StateView";
        } else {
            name = "" + name;
        }
        if (!target || (typeof target != "object" && typeof target != "function")) throw new TypeError("the target must be an object");
        if (typeof key != "string" && typeof key != "number" && typeof key != "symbol") throw new TypeError("State.view can't use a value of type " + typeof key + " as a key");
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
    Object: StateObject,
    Array: StateArray,
})

State.prototype = StatePrototype;

//#endregion State
//#region affect

function affect() {
    if (arguments.length < 2) throw new TypeError("undefined is not a function");
    const affector = arguments[arguments.length - 1];
    if (typeof affector != "function") throw new TypeError("affector is not a function");
    const everything = arguments.length == 2 && arguments[0] === "everything";
    const nothing = arguments.length == 2 && arguments[0] === "nothing";
    if (affector[sym_affect]) {
        if (!nothing) addAffectRefs(affector, everything ? null : arguments);
        affector[sym_affect]();
        return affector;
    }
    const affect_async = function affect() {
        if (affector[sym_affect_task] === false) {
            affector[sym_affect_task] = true;
            queueMicrotask(function affect() {
                if (!affector[sym_affect] || !affector[sym_affect_task]) return;
                affector[sym_affect_task] = false;
                const old_derived = current_derived;
                const old_derived_used = current_derived_used;
                current_derived = affector;
                try {
                    current_derived_used = null;
                    affector();
                    if (!current_derived_used) clearAffect(affector);
                } finally {
                    current_derived = old_derived;
                    current_derived_used = old_derived_used;
                }
            });
        }
    };

    Object.defineProperty(affector, sym_pideps, { configurable: true, value: new Map() }); //TODO! figure out how to correctly use this / if it is being correctly used
    Object.defineProperty(affector, sym_weak, { configurable: true, value: new WeakRef(affector) });
    Object.defineProperty(affector, sym_affect, { configurable: true, value: affect_async });
    Object.defineProperty(affector, sym_affect_refs, { configurable: true, value: new Set() });
    Object.defineProperty(affector, sym_affect_task, { configurable: true, writable: true, value: false });

    if (!nothing) addAffectRefs(affector, everything ? null : arguments);

    const old_derived = current_derived;
    const old_derived_used = current_derived_used;
    current_derived = affector;
    try {
        current_derived_used = false;
        affector();
        if (!current_derived_used) clearAffect(affector);
    } finally {
        current_derived = old_derived;
        current_derived_used = old_derived_used;
    }
    return affector;
}

/** @param {IArguments | null} references  */
function addAffectRefs(affector, references) {
    /** @type {Set<symbol | object>} */
    const refs = affector[sym_affect_refs];
    if (references) {
        for (let i = 0; i < references.length - 1; i++) {
            const reference = references[i];
            refs.add(reference);
            let set = affectFunctionsWeakRefs.get(reference);
            if (!set) affectFunctionsWeakRefs.set(reference, set = new Set());

            set.add(affector);
        }
    } else {
        if (refs.size) {
            for (const i of refs) {
                const set = affectFunctionsWeakRefs.get(refs);
                if (set) set.delete(affector);
            }
        }
        affectFunctionsRefs.add(affector);
    }
}

function clearAffect(affector) {
    if (typeof affector != "function") throw new TypeError("affector is not a function");
    const refs = sym_affect_refs[sym_affect_refs];
    delete affector[sym_affect_task];
    delete affector[sym_ders];
    delete affector[sym_pideps];
    delete affector[sym_weak];
    delete affector[sym_affect];
    delete affector[sym_affect_refs];
    if (refs) {
        for (const i of refs) {
            /** @type {Set | undefined} */
            const set = affectFunctionsWeakRefs.get(i);
            if (set && set.delete(affector) && set.size == 0) {
                affectFunctionsWeakRefs.delete(i);
            }
        }
    }
}

defineProperties(affect, { clear: clearAffect });

//#endregion
//#region invalidation

/** @param {Derived} target @param {boolean} [transitive] */
function invalidateDerivation(target, transitive) {
    if (target[sym_affect]) {
        target[sym_affect]();
        return;
    }
    let weak = target[sym_weak];
    if (!transitive) target[sym_weak] = null;
    /** @type {Set<WeakRef<Derived>>} */
    const derivations = target[sym_ders];
    if (
        derivations.size == 0
        || recursiveDerivationInvalidationGuard.has(target)
    ) return;
    recursiveDerivationInvalidationGuard.add(target);

    const copy = Array.from(derivations);
    derivations.clear();
    for (let i = 0; i < copy.length; i++) {
        const derived = copy[i].deref();
        /* istanbul ignore next */
        if (derived && derived[sym_weak] === copy[i]) {
            if (!weak) weak = new WeakRef(target);
            // TODO! it is clear here that the use of has here won't stop recursive loops if WeakRef is always being recreated
            // altough recursiveDerivationInvalidationGuard is good to have, maybe we could rely on this instead, seems more correct
            // this would require imply some weak ref that is permanent and does not track invalidation with a null value
            if (!derived[sym_pideps].has(weak)) {
                derived[sym_pideps].set(weak, target[sym_value]);
                invalidateDerivation(derived, true);
            }
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
        const proxy = new Proxy(value, StateObjectProxyHandler);
        Object.defineProperty(value, sym_ders, { value: { __proto__: null } });
        Object.defineProperty(value, sym_tracked, { value: proxy });
        const descriptors = Object.getOwnPropertyDescriptors(value);
        for (const key in descriptors) {
            const descriptor = descriptors[key];
            if (!("value" in descriptor)) continue;
            const old_prop_value = descriptor.value;
            const new_prop_value = track(old_prop_value);
            if (new_prop_value === old_prop_value) continue;
            if (descriptor.writable) {
                value[key] = new_prop_value;
            } else if (descriptor.configurable) {
                Object.defineProperty(value, key, {
                    value: new_prop_value,
                    writable: false,
                    enumerable: descriptor.enumerable,
                    configurable: true,
                });
            }
            // since writable and configurable is false, we can't update the property,
            // we can however change the way it is obtained through the proxy to return the correct tracked valued
            // hence we would need a call to the track function in the property getter
            // however, that might be too much of a performance hit, for such a small edge case (frozen properties), so we are not doing that for now
        }
        return proxy;
    } else if (proto == Array.prototype && Array.isArray(value)) {
        const descriptors = Object.getOwnPropertyDescriptors(value);
        for (let key = 0; key < value.length; key++) {
            const descriptor = descriptors[key];
            if (!("value" in descriptor)) continue;
            const old_prop_value = descriptor.value;
            const new_prop_value = track(old_prop_value);
            if (new_prop_value === old_prop_value) continue;
            if (descriptor.writable) {
                value[key] = new_prop_value;
            } else if (descriptor.configurable) {
                Object.defineProperty(value, key, {
                    value: new_prop_value,
                    writable: false,
                    enumerable: descriptor.enumerable,
                    configurable: true,
                });
            }
            // since writable and configurable is false, we can't update the property,
            // we can however change the way it is obtained through the proxy to return the correct tracked valued
            // hence we would need a call to the track function in the property getter
            // however, that might be too much of a performance hit, for such a small edge case (frozen properties), so we are not doing that for now
        }
        return createStateArray(value, StateArrayPrototype);
    }
    return value;
}

//#endregion
//#region object

function StateObject() {
    const value = new.target ? this : {};
    const proxy = new Proxy(value, StateObjectProxyHandler);
    Object.defineProperty(value, sym_ders, { value: { __proto__: null } });
    Object.defineProperty(value, sym_tracked, { value: proxy });
    return proxy;
}

defineProperties(StateObject, {
    [Symbol.hasInstance](target) {
        return target && typeof target == "object" && sym_tracked in target;
    },
    use(target) {
        if (!target || typeof target !== "object") throw new TypeError("target must be an object");
        if (!current_derived) return;
        const ders = target[sym_ders];
        if (!ders) return;
        let set = ders[sym_all];
        if (!set) ders[sym_all] = set = new Set();
        set.add(current_derived[sym_weak]);
        current_derived_used = true;
    }
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
            stateObjectUse(target, p);
            // the line below fixes the problem outlined in the track function
            // it is commentend out because it is called very often and may not justify the potential performance hit for fixing a very small edge case (frozen properties)
            //return track(Reflect.get(target, p, receiver));
        }
        return Reflect.get(target, p, receiver);
    },
    getOwnPropertyDescriptor(target, p) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, p);
        if (typeof p == "string" && (!descriptor || "value" in descriptor)) stateObjectUse(target, p);
        return descriptor;
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
    if (!current_derived) return;
    /** @type {Record<string | sym_all, Set<WeakRef<Derived>>>} */
    const ders = target[sym_ders];
    let set = ders[key];
    if (!set) ders[key] = set = new Set();
    set.add(current_derived[sym_weak]);
}

//#endregion
//#region array

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

function createStateArray(value, prototype) {
    const proxy = new Proxy(value, StateArrayProxyHandler);
    const length = value.length || 0;
    Object.setPrototypeOf(value, prototype);
    Object.defineProperty(value, sym_ders, { value: Array(length) });
    Object.defineProperty(value, sym_slots, { value: Array(length) });
    Object.defineProperty(value, sym_len, { value: new Set() });
    Object.defineProperty(value, sym_all, { value: new Set() });
    Object.defineProperty(value, sym_value, { value });
    Object.defineProperty(value, sym_tracked, { value: proxy });
    return proxy;
}

function StateArray(arrayLength) {
    if (typeof arrayLength != "number" && arrayLength !== undefined) throw new TypeError("arrayLength is not a number");
    const prototype = (constructor && constructor.prototype && typeof constructor.prototype == "object") ? constructor.prototype : StateArrayPrototype;
    return createStateArray(arrayLength, prototype);
}

defineProperties(StateArray, {
    [Symbol.hasInstance](target) {
        return Array.isArray(target) && sym_tracked in target;
    },
    use(target) {
        if (!target || typeof target !== "object" || !Array.isArray(target)) throw new TypeError("target must be an array");
        if (!current_derived || !(sym_len in target)) return;
        while (sym_src in target) target = target[sym_src];
        target[sym_all].add(current_derived[sym_weak]);
        current_derived_used = true;
    },
});

const StateArrayPrototype = defineProperties({ __proto__: Array.prototype }, {
    constructor: StateArray,
    push() {
        const target = /** @type {StringArray} */ (this[sym_value]);
        if (arguments.length) {
            for (let i = 0; i < arguments.length - 1; i++) {
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
        const target = /** @type {StringArray} */ (this[sym_value]);
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
        const target = /** @type {StringArray} */ (this[sym_value]);
        if (arguments.length) {
            for (let i = 0; i < arguments.length - 1; i++) {
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
        const target = /** @type {StringArray} */ (this[sym_value]);
        if (!target.length) return;
        const result = Array.prototype.shift.call(target);
        target[sym_ders].shift();
        target[sym_slots].shift();
        invalidateDerivationList(target[sym_ders]);
        invalidateDerivationSet(target[sym_len]);
        invalidateDerivationSet(target[sym_all]);
        return result;
    },
    splice() {
        throw new Error("TODO! StringArray.prototype.splice");
    },
    sort(callback) {
        throw new Error("TODO! StringArray.prototype.sort");
    },
    reverse() {
        const target = /** @type {StringArray} */ (this[sym_value]);
        Array.prototype.reverse.call(target);
        target[sym_ders].reverse();
        target[sym_slots].reverse();
        invalidateDerivationList(target[sym_ders]);
        invalidateDerivationSet(target[sym_len]);
        invalidateDerivationSet(target[sym_all]);
        return this;
    },
    copyWithin(dest, src, src_end) {
        throw new Error("TODO! StringArray.prototype.copyWithin");
    },
    fill(value, start, end) {
        throw new Error("TODO! StringArray.prototype.fill");
    },

    $map(derivator, thisArg) {
        return DerivedMapArray(this, derivator, thisArg);
    },
});

StateArray.prototype = StateArrayPrototype;

/** @type {ProxyHandler<StringArray>} */
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
        if (current_derived) target[sym_all].add(current_derived[sym_weak]);
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
                const ders = target[sym_ders].slice(new_length);
                const slots = target[sym_slots].slice(new_length);
                target.length = new_length;
                target[sym_ders].length = new_length;
                target[sym_slots].length = new_length;
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

/** @param {StringArray} target @param {string | symbol} prop   */
function stateArrayUseProp(target, prop) {
    if (!current_derived) return;
    if (prop === "length") {
        target[sym_len].add(current_derived[sym_weak]);
        return;
    }
    const index = as_index(prop);
    if (index === undefined) return;
    const length = target.length;
    if (index < length) {
        let set;

        const ders = target[sym_ders];
        set = ders[index];
        if (!set) ders[index] = set = new Set();
        set.add(current_derived[sym_weak]);

        const slots = target[sym_slots];
        set = slots[index];
        if (!set) slots[index] = set = new Set();
        set.add(current_derived[sym_weak]);
    } else {
        target[sym_len].add(current_derived[sym_weak]);
    }
}

//#region DerivedArray

function mutationOnDerivedArray() {
    throw new TypeError("cannot mutate derived array");
}

function DerivedArray(arrayLength) {
    // return StringArray instances and not DerivedArray instances,
    // this serves as a constructor with a different name for the DerivedArrayPrototype for better debugging
    // we return StringArray here to allow deep clones, jest needs it and possibly other libraries too
    if (typeof arrayLength != "number" && arrayLength !== undefined) throw new TypeError("arrayLength is not a number");
    const prototype = (constructor && constructor.prototype && typeof constructor.prototype == "object") ? constructor.prototype : StateArrayPrototype;
    return createStateArray(arrayLength, prototype);
}

const DerivedArrayPrototype = defineProperties({ __proto__: StateArrayPrototype }, {
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

/** @type {ProxyHandler<StringArray>} */
const DerivedArrayProxyHandler = {
    defineProperty() { mutationOnDerivedArray(); },
    deleteProperty() { mutationOnDerivedArray(); },
    set() { mutationOnDerivedArray(); },
    setPrototypeOf() { mutationOnDerivedArray(); },
    preventExtensions() { mutationOnDerivedArray(); },
};

//#endregion

//#region DerivedMapArray

function DerivedMapArray(src, derivator, thisArg) {
    const value = Array();
    const proxy = new Proxy(value, DerivedMapArrayProxyHandler);
    Object.setPrototypeOf(value, DerivedArrayPrototype);
    Object.defineProperty(value, sym_ders, { value: src[sym_ders] });
    Object.defineProperty(value, sym_slots, { value: src[sym_slots] });
    Object.defineProperty(value, sym_len, { value: src[sym_len] });
    Object.defineProperty(value, sym_all, { value: src[sym_all] });
    Object.defineProperty(value, sym_value, { value });
    Object.defineProperty(value, sym_tracked, { value: proxy });

    Object.defineProperty(value, sym_src, { value: src });
    Object.defineProperty(value, sym_derivator, { value: derivator.bind(thisArg) });
    Object.defineProperty(value, sym_cache, { value: new WeakMap() });
    return proxy;
}

/** @typedef {StringArray & {[sym_src]: StringArray, [sym_derivator](value: T, index: Derived, array: T[]): U, [sym_cache]: WeakMap<Set<WeakKey<Derived>>, Derived>}} DerivedMapArray */

/** @type {ProxyHandler<DerivedMapArray>} */
const DerivedMapArrayProxyHandler = {
    ...DerivedArrayProxyHandler,
    get(target, p, receiver) {
        if (p === "length") {
            return target[sym_src].length;
        }
        const index = as_index(p);
        if (index !== undefined) return derivedMapArrayGet(target, index);
        return Reflect.get(target, p, receiver);
    },
    getOwnPropertyDescriptor(target, p) {
        if (p === "length") {
            return {
                value: target[sym_src].length,
                writable: true,
                enumerable: false,
                configurable: false,
            };
        }
        const index = as_index(p);
        if (index !== undefined) return {
            value: derivedMapArrayGet(target, index),
            writable: false,
            enumerable: false,
            configurable: true,
        };
        return Reflect.getOwnPropertyDescriptor(target, p);
    },
    //getPrototypeOf(target) {},
    has(target, p) {
        if (p === "length") {
            return true;
        }
        const index = as_index(p);
        if (index !== undefined) return index in target[sym_src];
        return Reflect.has(target, p);
    },
    isExtensible(target) {
        return true;
    },
    ownKeys(target) {
        const src = target[sym_src];
        const length = src.length;
        const keys = [];
        for (let i = 0; i < length; i++) {
            if (i in src) keys[keys.length] = "" + i;
        }
        keys[keys.length] = "length";
        keys.push(...Object.getOwnPropertySymbols(target));
        return keys;
    },
};

/** @param {DerivedMapArray} target @param {number} index */
function derivedMapArrayGet(target, index) {
    const src = target[sym_src];
    const cache = target[sym_cache];
    const slots = src[sym_slots];
    if (index >= slots.length) {
        // the `target.length` produces the side effect of using the length,
        // and we just so happen to need to return undefined in this case
        return void src.length;
    }
    let set = slots[index];
    if (!set) slots[index] = set = new Set();
    if (cache.has(set)) {
        return cache.get(set)();
    }
    //const fixed_set = target[sym_ders][index];
    //const derived_index = function DerivedIndex() {
    //    if (current_derived) fixed_set.add(current_derived[sym_weak]);
    //    return index;
    //};

    // TODO! implement the index derived in the call to the mapper function below

    // Derived.from
    // const derived = function Derived() { return value; };
    // Object.setPrototypeOf(derived, DerivedPrototype);
    // Object.defineProperty(derived, sym_ders, { value: new Set() });
    // Object.defineProperty(derived, sym_pideps, { value: new Map() });
    // Object.defineProperty(derived, sym_weak, { value: new WeakRef(derived) });
    // return derived;

    const cached = new Derived(() => {
        if (current_derived) set.add(current_derived[sym_weak]);
        // TODO! index
        return target[sym_derivator](target[sym_src][index], Derived.from(NaN), target[sym_src][sym_tracked]);
    });
    cache.set(set, cached);
    return cached();
}

//#endregion

//#region array helper functions
function normalize_length(length, max) {
    length = Math.floor(Number(length));
    if (Number.isNaN(length)) return 0;
    if (length < 0) return 0;
    if (length > max) return max;
    return length;
}
function normalize_start(start, length) {
    start = Math.floor(Number(start));
    if (Number.isNaN(start)) return 0;
    if (start < 0) start += length;
    if (start < 0) return 0;
    if (start >= length) return length;
    return start;
}
function normalize_end(end, length) {
    end = Math.floor(Number(end));
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
    if (typeof key == "number" && key >= 0 && key <= 0xFFFFFFFE && Number.isSafeInteger(key)) return key;
    return undefined;
}
function as_length(key) {
    if (typeof key == "string") {
        const int = +key;
        if ("" + int === key) key = int;
    }
    if (typeof key == "number" && key >= 0 && key <= 0xFFFFFFFF && Number.isSafeInteger(key)) return key;
    return undefined;
}
//#endregion

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

module.exports = {
    __proto__: null,
    Derived,
    State,
};
