//#region sym

/** the derivations of this object (Derived objects that depend on this), present on all objects that can be depended on such as State and Derived
 *
 * on `State` and `Derived` this is always a `Set<WeakRef<Derived>>`
 *
 * on `TrackedObject` this is always a `Record<string | sym_all, Set<WeakRef<Derived>>>` with null prototype
 *
 * the value is `WeakRef<Derived>` and if it matches `.deref()[sym_weak]` that means the derivation is still active
 *
 * if it does not match, this weakref can be discarded, since it was from an outdated derivation */
const sym_ders = Symbol("ders");

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

/** the value of this object, always exists on State, and exists on Derived unless it is being actively derived or has never being derived */
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

/** a symbol present on tracked objects, the value is itself, useful to reobtain the proxied version of an object to avoid unecessary creation of duplicate proxies */
const sym_tracked = Symbol("tracked");

/** a symbol used by `TrackedObject[sym_ders]` when something depends on all string properties */
const sym_all = Symbol("all");

//#endregion
//#region globals

/** @typedef {{ [sym_pideps]: Set<WeakRef<Derived>>, [sym_ders]: Set<WeakRef<Derived>>, [sym_weak]: WeakRef<Derived>, [sym_value]?: any }} Derived */

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
            forEachDerivedWeakSet(this[sym_ders], invalidateDerivations);
        }
        return value;
    },
    mut(transformer) {
        if (typeof transformer != "function") throw new TypeError("transformer is not a function");
        const value = transformer(this[sym_value]);
        if (!Object.is(this[sym_value], value)) {
            this[sym_value] = value;
            forEachDerivedWeakSet(this[sym_ders], invalidateDerivations);
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

defineProperties(affect, {
    ignore(affector) {
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
});

//#endregion
//#region invalidation

/** @param {Derived} target @param {boolean} [transitive] */
function invalidateDerivations(target, transitive) {
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
    forEachDerivedWeakSet(derivations, derived => {
        if (!weak) weak = new WeakRef(target);
        // TODO! it is clear here that the use of has here won't stop recursive loops if WeakRef is always being recreated
        // altough recursiveDerivationInvalidationGuard is good to have, maybe we could rely on this instead, seems more correct
        // this would require imply some weak ref that is permanent and does not track invalidation with a null value
        if (!derived[sym_pideps].has(weak)) {
            derived[sym_pideps].add(weak);
            invalidateDerivations(derived, true);
        }
    });
    recursiveDerivationInvalidationGuard.delete(target);
}
/** @param {Set<WeakRef<Derived>>} set @param {(arg: Derived) => void} callback */
function forEachDerivedWeakSet(set, callback) {
    const src = Array.from(set);
    set.clear();
    for (let i = 0; i < src.length; i++) {
        const derived = src[i].deref();
        /* istanbul ignore next */
        if (derived && derived[sym_weak] === src[i]) {
            callback(derived);
        }
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
    if (proto === null || proto === Object.prototype) {
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
            } else {
                // since writable and configurable is false, we can't update the property,
                // we can however change the way it is obtained through the proxy to return the correct tracked valued
                // hence the call to tracked in the property getter
            }
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
        if (typeof p == "string" && target in p) {
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
            return track(Reflect.get(target, p, receiver));
        } else {
            return Reflect.get(target, p, receiver);
        }
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
    const ders1 = ders[key];
    const ders2 = ders[sym_all];
    if (ders1) forEachDerivedWeakSet(ders1, invalidateDerivations);
    if (ders2) forEachDerivedWeakSet(ders2, invalidateDerivations);
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

module.exports = {
    __proto__: null,
    Derived,
    State,
    affect,
    track,
    TrackedObject,
};
