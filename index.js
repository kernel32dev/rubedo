
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

/** @typedef {{ [sym_pideps]: Set<WeakRef<Derived>>, [sym_ders]: Set<WeakRef<Derived>>, [sym_weak]: WeakRef<Derived>, [sym_value]?: any }} Derived */

/** @type {Derived | null} */
let current_derived = null;

/** this may be unecessary because circular derivation is already being detected, but i could not prove this */
const recursiveDerivationInvalidationGuard = new WeakSet();

//#region Derived

const DerivedPrototype = { __proto__: Function.prototype };

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

Derived.prototype = DerivedPrototype;

//#endregion Derived
//#region State

const StatePrototype = defineProperties({ __proto__: DerivedPrototype }, {
    set(value) {
        if (Object.is(this[sym_value], value)) return;
        this[sym_value] = value;
        /** @type {Set<WeakRef<Derived>>} */
        const derivations = this[sym_ders];
        forEachDerivedWeakSet(derivations, derived => {
            derived[sym_weak] = null;
            invalidateDerivations(derived);
        });
        derivations.clear();
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

/** @@param {Derived} target */
function invalidateDerivations(target) {
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
    derivations.clear();
    recursiveDerivationInvalidationGuard.delete(target);
}

function defineProperties(target, properties) {
    for (const key in properties) {
        Object.defineProperty(target, key, { writable: true, configurable: true, value: properties[key] });
    }
    return target;
}

/** @param {Set<WeakRef<Derived>>} set @param {(arg: Derived) => void} callback */
function forEachDerivedWeakSet(set, callback) {
    const src = Array.from(set);
    for (let i = 0; i < src.length; i++) {
        const derived = src[i].deref();
        /* istanbul ignore next */
        if (derived && derived[sym_weak] === src[i]) {
            callback(derived);
        } else {
            /* istanbul ignore next */
            set.delete(derived);
        }
    }
}

module.exports = {
    __proto__: null,
    Derived,
    State,
};
