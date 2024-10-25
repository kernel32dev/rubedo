//#region sym

/** the derivations of this object (Derived objects that depend on this), present on all objects that can be depended on such as State and Derived
 *
 * this is always a `Set<WeakRef<Derived>>`
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

//#endregion
//#region globals

/** @typedef {{ [sym_pideps]: Set<WeakRef<Derived>>, [sym_ders]: Set<WeakRef<Derived>>, [sym_weak]: WeakRef<Derived>, [sym_value]?: any }} Derived */

/** @type {Derived | null} */
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
    then(derivator) {
        const derived = this;
        return new Derived(function then() {
            return derivator(derived());
        });
    }
});

function Derived(derivator, name) {
    if (!new.target) throw new TypeError("Constructor Derived requires 'new'");
    if (typeof derivator !== "function") throw new TypeError("Derivator is not a function");
    if (typeof name !== "string" || !name) name = "Derived";
    /** @type {Derived} */
    const Derived = ({
        [name]() {
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
                }
                if (pideps.size == 0) return Derived[sym_value];
            }
            const old_derived = current_derived;
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
    set(value) {
        if (Object.is(this[sym_value], value)) return;
        this[sym_value] = value;
        forEachDerivedWeakSet(this[sym_ders], derived => {
            derived[sym_weak] = null;
            invalidateDerivations(derived);
        });
    }
});

function State(value, name) {
    if (!new.target) throw new TypeError("Constructor State requires 'new'");
    if (typeof name !== "string" || !name) name = "State";
    const State = ({
        [name]() {
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
//#region react

function react(affector, reference) {
    if (typeof affector != "function") throw new TypeError("affector is not a function");
    // TODO! automatically ignore affector if it ever runs without using any derivations
    if (!affector[sym_react]) {
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
    }
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

//#endregion
//#region invalidation

/** @@param {Derived} target */
function invalidateDerivations(target) {
    if (target[sym_react]) {
        target[sym_react]();
        return;
    }
    /** @type {Set<WeakRef<Derived>>} */
    const derivations = target[sym_ders];
    if (
        derivations.size == 0
        || recursiveDerivationInvalidationGuard.has(target)
    ) return;
    recursiveDerivationInvalidationGuard.add(target);
    const weak = target[sym_weak] || new WeakRef(target);
    forEachDerivedWeakSet(derivations, derived => {
        // TODO! it is clear here that the use of has here won't stop recursive loops if WeakRef is always being recreated
        // altough recursiveDerivationInvalidationGuard is good to have, maybe we could rely on this instead, seems more correct
        if (!derived[sym_pideps].has(weak)) {
            derived[sym_pideps].add(weak);
            invalidateDerivations(derived);
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

module.exports = {
    __proto__: null,
    Derived,
    State,
    react,
    ignore,
};
