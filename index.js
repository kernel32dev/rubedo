//@ts-nocheck
"use strict";
//#region sym

/** the derivations of this object (Derived objects that depend on this), present on all objects that can be depended on such as State and Derived
 *
 * on `State` and `Derived` this is always a `Set<WeakRef<Derived>>`
 *
 * on `TrackedObject` this is always a `Record<string | sym_all, Set<WeakRef<Derived>>>` with null prototype
 *
 * on `TrackedArray` this is always a `(Set<WeakRef<Derived>> | <empty>)[]` (each item represents the corresponding item in the real array by index, (shifting will invalidate later slots))
 *
 * the value is `WeakRef<Derived>` and if it matches `.deref()[sym_weak]` that means the derivation is still active
 *
 * if it does not match, this weakref can be discarded, since it was from an outdated derivation */
const sym_ders = Symbol("ders");

/** the slot based derivations of this array, present on all `TrackedArray`
 *
 * unlike sym_ders, shifting will **not** invalidate later slots
 *
 * will be used by deriving functions that do not rely on the position of the element
 */
const sym_slots = Symbol("slots");

/** the derivations of the array's length, present on all `TrackedArray` */
const sym_len = Symbol("len");

/** the invalidated and possibly invalidated dependencies of this object, present only on Derived objects
 *
 * having a non empty set on this value means this Derived is possibly invalidated, it is possibly invalidated if any of the deriveds in this set are invalidated
 *
 * this is always a `Set<WeakRef<Derived>>`
 *
 * the value is `WeakRef<Derived>` unlike sym_ders, it does not matter if it matches `.deref()[sym_weak]`, the point here is just to have a weak reference to the dependend object
 *
 * it should safe to use a weak ref here, because it is garbage collected, then it was not a dependency anyway
 *
 * if it does not match then this derived is definitively invalidated */
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

/** the value of this object, always exists on State, and exists on Derived unless it is being actively derived or has never being derived
 *
 * also used by `TrackedArray` to store itself not wrapped in a proxy
 */
const sym_value = Symbol("value");

/** the derivator function of the derivator object, exists only on Derived */
const sym_derivator = Symbol("derivator");

/** this symbols is present when it is a reactive derivation
 *
 * when those derivations are invalidated, a microtask is scheduled to automatically rerun the derivator
 *
 * the value is a boolean, and it is true when the microtask is scheduled, and false when not
 *
 * if it is true, setting it to false or unsetting it can also be used to cancel the pending task
 */
const sym_react_task = Symbol("react task");

/** this symbols is present when it is a reactive derivation
 *
 * this contains a function that must be called whenever a dependency of the derivation changes
 */
const sym_react = Symbol("react");

/** the set of references that are present in reactiveFunctionsRefs */
const sym_react_refs = Symbol("react");

/** a symbol present on tracked objects, the value is itself after tracking
 *
 * used to reobtain the proxied version of an object to avoid unecessary creation of duplicate proxies
 */
const sym_tracked = Symbol("tracked");

/** a symbol used by `TrackedObject[sym_ders]` when something depends on all string properties
 *
 * also used by `TrackedArray` to store derivations `Set<WeakRef<Derived>>` that need all values
 */
const sym_all = Symbol("all");

//#endregion
//#region globals

/** @typedef {{ [sym_pideps]: Set<WeakRef<Derived>>, [sym_ders]: Set<WeakRef<Derived>>, [sym_weak]: WeakRef<Derived>, [sym_value]?: any }} Derived */
/** @typedef {{ [sym_ders]: Set<WeakRef<Derived>>[], [sym_slots]: Set<WeakRef<Derived>>[], [sym_len]: Set<WeakRef<Derived>>, [sym_all]: Set<WeakRef<Derived>>, [sym_value]: TrackedArray, [sym_tracked]: TrackedArray } & any[]} TrackedArray */

/** if this value is set, it is the derived currently running at the top of the stack
 *
 * if it is null, it means we are outside a derived
 *
 * if it is false, it means we are ignoring dependencies
 *
 * @type {Derived | null | false} */
let current_derived = null;

/** flag that is set everytime the derivation is used
 *
 * useful to detect when a derivation has no dependencies
 */
let current_derived_used = true;

/** this may be unecessary because circular derivation is already being detected, but i could not prove this */
const recursiveDerivationInvalidationGuard = new WeakSet();

/** a map of references that keep reactive functions from being garbage collected */
const reactiveFunctionsRefs = new WeakMap();

//#endregion
//#region Derived

const DerivedPrototype = defineProperties({ __proto__: Function.prototype }, {
    constructor: Derived,
    now() {
        if (current_derived !== null) throw new Error(current_derived
            ? "can't call method now inside of a derivation, call the derived or call the now method outside a derivation"
            : "can't call method now inside of another call to Derived.now, call the derived or call the now method outside a derivation");
        const old_derived_used = current_derived_used;
        current_derived = false;
        try {
            return this();
        } finally {
            current_derived = null;
            current_derived_used = old_derived_used;
        }
    },
    untracked() {
        const old_derived = current_derived;
        const old_derived_used = current_derived_used;
        current_derived = false;
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
    name = name === "State" ? derivator.name || name : name;
    /** @type {Derived} */
    const Derived = ({
        [name]() {
            if (current_derived === null) throw new Error("can't call a derived outside of a derivation, use the now method or call this inside a derivation");

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
                const arr = Array.from(pideps);
                const old_derived = current_derived;
                const old_derived_used = current_derived_used;
                current_derived = false; // this null ensures the true invalidation tests below don't add any derivations
                try {
                    // this for finds all references in pideps that don't point to an invalidated derived, and stops as soon as it finds one
                    for (let i = 0; i < arr.length; i++) {
                        const weak = arr[i];
                        const derived = weak.deref();
                        if (!derived) {
                            pideps.delete(weak);
                            continue;
                        }
                        const old_value = derived[sym_value];
                        // TODO! somehow ensure this can't cause an infinite recursive loop
                        if (Object.is(old_value, derived())) {
                            pideps.delete(weak);
                        } else {
                            break;
                        }
                    }
                } finally {
                    current_derived = old_derived;
                    current_derived_used = old_derived_used;
                }
                if (pideps.size == 0) return Derived[sym_value];
            }
            const old_derived = current_derived;
            const old_derived_used = current_derived_used;
            current_derived = Derived;
            const old_value = Derived[sym_value];
            const old_weak = Derived[sym_weak];
            try {
                delete Derived[sym_value];
                Derived[sym_weak] = new WeakRef(Derived);
                const value = Derived[sym_derivator]();
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
    Object.defineProperty(Derived, sym_pideps, { value: new Set() });
    Object.defineProperty(Derived, sym_weak, { writable: true, value: null });
    Object.defineProperty(Derived, sym_derivator, { value: derivator });
    return Derived;
}

defineProperties(Derived, {
    now(derivator) {
        if (current_derived !== null) throw new Error(current_derived
            ? "can't call method now inside of a derivation, call the derived or call the now method outside a derivation"
            : "can't call method now inside of another call to Derived.now, call the derived or call the now method outside a derivation");
        const old_derived_used = current_derived_used;
        current_derived = false;
        try {
            return derivator();
        } finally {
            current_derived = null;
            current_derived_used = old_derived_used;
        }
    },
    from(value) {
        if (value instanceof Derived) return value;
        const derived = function Derived() { return value; };
        Object.setPrototypeOf(derived, DerivedPrototype);
        Object.defineProperty(derived, sym_ders, { value: new Set() });
        Object.defineProperty(derived, sym_pideps, { value: new Set() });
        Object.defineProperty(derived, sym_weak, { value: new WeakRef(derived) });
        return derived;
    },
    use(value) {
        return value instanceof Derived ? value() : value;
    },
})

Derived.prototype = DerivedPrototype;

//#endregion Derived
//#region State

const StatePrototype = defineProperties({ __proto__: DerivedPrototype }, {
    constructor: State,
    now() {
        if (current_derived !== null) throw new Error("can't call method now inside of a derivation, call the state or call the now method outside a derivation");
        return this[sym_value];
    },
    untracked() {
        return this[sym_value];
    },
    set(value) {
        if (!Object.is(this[sym_value], value)) {
            this[sym_value] = value;
            invalidateDerivationSet(this[sym_ders]);
        }
        return value;
    },
    mut(transformer) {
        if (typeof transformer != "function") throw new TypeError("transformer is not a function");
        const value = transformer(this[sym_value]);
        if (!Object.is(this[sym_value], value)) {
            this[sym_value] = value;
            invalidateDerivationSet(this[sym_ders]);
        }
        return value;
    },
});

function State(name, value) {
    if (!new.target) throw new TypeError("Constructor State requires 'new'");
    if (arguments.length == 1) {
        value = name;
        name = "State";
    }
    const State = ({
        [name]() {
            if (current_derived === null) throw new Error("can't call a state outside of a derivation, use the now method or call this inside a derivation");
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
    State[sym_value] = value;
    return State;
}

State.prototype = StatePrototype;

//#endregion State
//#region affect

function affect(affector, reference) {
    if (typeof affector != "function") throw new TypeError("affector is not a function");
    if (affector[sym_react]) {
        affector[sym_react]();
        return affector;
    }
    const react_async = function react() {
        if (affector[sym_react_task] === false) {
            affector[sym_react_task] = true;
            queueMicrotask(function react() {
                if (!affector[sym_react] || !affector[sym_react_task]) return;
                affector[sym_react_task] = false;
                const old_derived = current_derived;
                const old_derived_used = current_derived_used;
                current_derived = affector;
                try {
                    current_derived_used = false;
                    affector();
                    if (!current_derived_used) ignore(affector);
                } finally {
                    current_derived = old_derived;
                    current_derived_used = old_derived_used;
                }
            });
        }
    };
    const refs = new Set();
    Object.defineProperty(affector, sym_pideps, { configurable: true, value: new Set() });
    Object.defineProperty(affector, sym_weak, { configurable: true, value: new WeakRef(affector) });
    Object.defineProperty(affector, sym_react, { configurable: true, value: react_async });
    Object.defineProperty(affector, sym_react_refs, { configurable: true, value: refs });
    Object.defineProperty(affector, sym_react_task, { configurable: true, writable: true, value: false });
    reference = reference || reactiveFunctionsRefs;
    refs.add(reference);
    let set = reactiveFunctionsRefs.get(reference);
    if (!set) reactiveFunctionsRefs.set(reference, set = new Set());
    set.add(affector);

    const old_derived = current_derived;
    const old_derived_used = current_derived_used;
    current_derived = affector;
    try {
        current_derived_used = false;
        affector();
        if (!current_derived_used) ignore(affector);
    } finally {
        current_derived = old_derived;
        current_derived_used = old_derived_used;
    }
    return affector;
}

function ignore(affector) {
    if (typeof affector != "function") throw new TypeError("affector is not a function");
    const refs = sym_react_refs[sym_react_refs];
    delete affector[sym_react_task];
    delete affector[sym_ders];
    delete affector[sym_pideps];
    delete affector[sym_weak];
    delete affector[sym_react];
    delete affector[sym_react_refs];
    if (refs) {
        for (const i of refs) {
            /** @type {Set | undefined} */
            const set = reactiveFunctionsRefs.get(i);
            if (set && set.delete(affector) && set.size == 0) {
                reactiveFunctionsRefs.delete(i);
            }
        }
    }
}

defineProperties(affect, { ignore });

//#endregion
//#region invalidation

/** @param {Derived} target @param {boolean} [transitive] */
function invalidateDerivation(target, transitive) {
    if (target[sym_react]) {
        target[sym_react]();
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
                derived[sym_pideps].add(weak);
                invalidateDerivation(derived, true);
            }
        }
    }
    recursiveDerivationInvalidationGuard.delete(target);
}
/** @param {Set<WeakRef<Derived>> | undefined | null} set */
function invalidateDerivationSet(set) {
    if (!set) return;
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
        const proxy = new Proxy(value, TrackedObjectProxyHandler);
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
        const proxy = new Proxy(value, TrackedArrayProxyHandler);
        Object.setPrototypeOf(value, TrackedArrayPrototype);
        //Object.defineProperty(value, sym_ders, { value: /*TODO! ?*/ });
        Object.defineProperty(value, sym_tracked, { value: proxy });
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
        return proxy;
    }
    return value;
}

//#endregion
//#region object

function TrackedObject() {
    if (!new.target) throw new TypeError("Constructor TrackedObject requires 'new'");
    const proxy = new Proxy(this, TrackedObjectProxyHandler);
    Object.defineProperty(this, sym_ders, { value: { __proto__: null } });
    Object.defineProperty(this, sym_tracked, { value: proxy });
    return proxy;
}

TrackedObject.prototype = Object.prototype;

/** @type {ProxyHandler} */
const TrackedObjectProxyHandler = {
    //apply(target, thisArg, argArray) {
    //    return Reflect.apply(target, thisArg, argArray);
    //},
    //construct(target, thisArg, argArray) {
    //    return Reflect.construct(target, thisArg, argArray);
    //},
    defineProperty(target, property, attributes) {
        const result = Reflect.defineProperty(target, property, attributes);
        if (result && typeof property == "string") trackedObjectInvalidate(target, property); // TODO! check if the property really did change
        return result;
    },
    deleteProperty(target, p) {
        if (typeof p == "string" && p in target) {
            const result = Reflect.deleteProperty(target, p);
            if (result) trackedObjectInvalidate(target, p);
            return result;
        } else {
            return Reflect.deleteProperty(target, p);
        }
    },
    get(target, p, receiver) {
        if (typeof p == "string") {
            trackedObjectUse(target, p);
            // the line below fixes the problem outlined in the track function
            // it is commentend out because it is called very often and may not justify the potential performance hit for fixing a very small edge case (frozen properties)
            //return track(Reflect.get(target, p, receiver));
        }
        return Reflect.get(target, p, receiver);
    },
    getOwnPropertyDescriptor(target, p) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, p);
        if (typeof p == "string" && (!descriptor || "value" in descriptor)) trackedObjectUse(target, p);
        return descriptor;
    },
    // getPrototypeOf(target) {
    //     return Reflect.getPrototypeOf(target);
    // },
    has(target, p) {
        if (typeof p == "string") trackedObjectUse(target, p);
        return Reflect.has(target, p);
    },
    // isExtensible(target) {
    //     return Reflect.isExtensible(target);
    // },
    ownKeys(target) {
        trackedObjectUse(target, sym_all);
        return Reflect.ownKeys(target);
    },
    // preventExtensions(target) {
    //     return Reflect.preventExtensions(target);
    // },
    set(target, p, newValue, receiver) {
        const result = Reflect.set(target, p, newValue, receiver);
        if (typeof p == "string") trackedObjectInvalidate(target, p); // TODO! check if a value property really did change
        return result;
    },
    // setPrototypeOf(target, v) {
    //     return Reflect.setPrototypeOf(target, v);
    // },
};

/** @param {string} key */
function trackedObjectInvalidate(target, key) {
    /** @type {Record<string | sym_all, Set<WeakRef<Derived>>>} */
    const ders = target[sym_ders];
    invalidateDerivationSet(ders[key]);
    invalidateDerivationSet(ders[sym_all]);
}

/** @param {string | sym_all} key */
function trackedObjectUse(target, key) {
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

function TrackedArray(arrayLength) {
    if (typeof arrayLength != "number" && arrayLength !== undefined) {
        throw new TypeError("arrayLength is not a number");
    }
    arrayLength = arrayLength || 0;
    const value = Array(arrayLength);
    const proxy = new Proxy(value, TrackedArrayProxyHandler);
    Object.setPrototypeOf(value, (new.target && new.target.prototype && typeof new.target.prototype == "object") ? new.target.prototype : TrackedArrayPrototype);
    Object.defineProperty(value, sym_ders, { value: Array(arrayLength) });
    Object.defineProperty(value, sym_slots, { value: Array(arrayLength) });
    Object.defineProperty(value, sym_len, { value: new Set() });
    Object.defineProperty(value, sym_all, { value: new Set() });
    Object.defineProperty(value, sym_value, { value });
    Object.defineProperty(value, sym_tracked, { value: proxy });
    return proxy;
}

const TrackedArrayPrototype = defineProperties({ __proto__: Array.prototype }, {
    constructor: TrackedArray,
    push() {
        const target = /** @type {TrackedArray} */ (this[sym_value]);
        if (arguments.length) {
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
        const target = /** @type {TrackedArray} */ (this[sym_value]);
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
        const target = /** @type {TrackedArray} */ (this[sym_value]);
        if (arguments.length) {
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
        const target = /** @type {TrackedArray} */ (this[sym_value]);
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
        throw new Error("TODO! TrackedArray.prototype.splice");
    },
    sort(callback) {
        throw new Error("TODO! TrackedArray.prototype.sort");
    },
    reverse() {
        const target = /** @type {TrackedArray} */ (this[sym_value]);
        Array.prototype.reverse.call(target);
        target[sym_ders].reverse();
        target[sym_slots].reverse();
        invalidateDerivationList(target[sym_ders]);
        invalidateDerivationSet(target[sym_len]);
        invalidateDerivationSet(target[sym_all]);
        return this;
    },
    copyWithin(dest, src, src_end) {
        throw new Error("TODO! TrackedArray.prototype.copyWithin");
    },
    fill(value, start, end) {
        throw new Error("TODO! TrackedArray.prototype.fill");
    },
});

TrackedArray.prototype = TrackedArrayPrototype;

/** @type {ProxyHandler<TrackedArray>} */
const TrackedArrayProxyHandler = {
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
        trackedArrayUseProp(target, p);
        return Reflect.get(target, p, receiver);
    },
    getOwnPropertyDescriptor(target, p) {
        trackedArrayUseProp(target, p);
        return Reflect.getOwnPropertyDescriptor(target, p);
    },
    // getPrototypeOf(target) {
    //     return Reflect.getPrototypeOf(target);
    // },
    has(target, p) {
        trackedArrayUseProp(target, p);
        return Reflect.has(target, p);
    },
    // isExtensible(target) {
    //     return Reflect.isExtensible(target);
    // },
    ownKeys(target) {
        target[sym_all].add(current_derived[sym_weak]);
        return Reflect.ownKeys(target);
    },
    // preventExtensions(target) {
    //     return Reflect.preventExtensions(target);
    // },
    set(target, p, newValue, receiver) {
        if (p === "length") {
            const new_length = as_length(newValue);
            if (new_length === undefined) throw new Error("invalid length value");
            const old_length = target.length;
            if (new_length > old_length) {
                target.length = new_length;
                target[sym_ders].length = new_length;
                target[sym_slots].length = new_length;
                const result = Reflect.set(target, p, newValue, receiver);
                invalidateDerivationSet(target[sym_len]);
                invalidateDerivationSet(target[sym_all]);
                return result;
            } else if (new_length < old_length) {
                const ders = target[sym_ders].slice(new_length);
                const slots = target[sym_slots].slice(new_length);
                target.length = new_length;
                target[sym_ders].length = new_length;
                target[sym_slots].length = new_length;
                const result = Reflect.set(target, p, newValue, receiver);
                invalidateDerivationList(ders);
                invalidateDerivationList(slots);
                invalidateDerivationSet(target[sym_len]);
                invalidateDerivationSet(target[sym_all]);
                return result;
            } else {
                return Reflect.set(target, p, newValue, receiver);
            }
        }
        const index = as_index(p);
        if (index !== undefined) {
            let length_updated = false;
            if (target.length <= index) {
                target.length = index + 1;
                target[sym_ders].length = index + 1;
                target[sym_slots].length = index + 1;
                length_updated = true;
            }
            const result = Reflect.set(target, p, newValue, receiver);
            invalidateDerivationSet(target[sym_ders][index]);
            invalidateDerivationSet(target[sym_slots][index]);
            if (length_updated) invalidateDerivationSet(target[sym_len]);
            invalidateDerivationSet(target[sym_all]);
            return result;
        }
        return Reflect.set(target, p, newValue, receiver);
    },
    // setPrototypeOf(target, v) {
    //     return Reflect.setPrototypeOf(target, v);
    // },
};

/** @param {TrackedArray} target @param {string | symbol} prop   */
function trackedArrayUseProp(target, prop) {
    if (prop === "length") {
        target[sym_len].add(current_derived[sym_weak]);
        return;
    }
    const index = as_index(prop);
    if (index === undefined) return;
    const length = target.length;
    if (index < length) {
        target[sym_ders][index].add(current_derived[sym_weak]);
        target[sym_slots][index].add(current_derived[sym_weak]);
    } else {
        target[sym_len].add(current_derived[sym_weak]);
    }
}

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

module.exports = {
    __proto__: null,
    Derived,
    State,
    affect,
    track,
    TrackedObject,
    TrackedArray,
};
