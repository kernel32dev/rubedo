
/** the dependencies of this object, if they are invalidated so am i, present only on Derived objects
 *
 * this is always a `Map<{dependency}, {information about dependency}>`
 */
const sym_deps = Symbol("deps");

/** the derivations of this object (Derived objects that depend on this), present on all objects that can be depended on such as State and Derived
 *
 * this is always a `Set<WeakRef<Derived>>` */
const sym_ders = Symbol("ders");

/** the only `WeakRef<Derived>` to this derived object, present only on Derived objects */
const sym_weak = Symbol("weak");

/** the value of this object, always exists on State, and exists on Derived unless it is invalidated */
const sym_value = Symbol("value");

/** the derivator function of the derivator object, exists only on Derived */
const sym_derivator = Symbol("derivator");

/** @typedef {{ [sym_deps]: Map<unknown, unknown>, [sym_ders]: Set<Derived>, [sym_weak]: WeakRef<Derived>, [sym_value]?: any }} Derived */

/** @type {Derived | null} */
let current_derived = null;

const recursiveDerivationGuard = new WeakSet();

/** this may be unecessary because of the guard above, but i could not prove this */
const recursiveDerivationInvalidationGuard = new WeakSet();

//#region Derived

const DerivedPrototype = { __proto__: Function.prototype };

function Derived(derivator, name) {
    if (!new.target) throw new TypeError("Constructor Derived requires 'new'");
    if (typeof derivator !== "function") throw new TypeError("Derivator is not a function");
    if (typeof name !== "string" || !name) name = "Derived";
    const Derived = ({[name]() {
        if (current_derived) {
            // add myself as a dependency of the current derivator
            current_derived[sym_deps].set(Derived, undefined);
            // add the current derivator as a derivation of myself
            Derived[sym_ders].add(current_derived[sym_weak]);
        }
        if (sym_value in Derived) return Derived[sym_value];
        Derived[sym_deps].clear();
        if (recursiveDerivationGuard.has(Derived)) {
            // TODO! add information to help pin down the loop
            throw new RangeError("Circular dependency between derives detected");
        }
        const old_derived = current_derived;
        current_derived = Derived;
        recursiveDerivationGuard.add(Derived);
        try {
            return Derived[sym_value] = Derived[sym_derivator]();
        } finally {
            recursiveDerivationGuard.delete(Derived);
            current_derived = old_derived;
        }
    }})[name];
    Object.setPrototypeOf(Derived, typeof new.target.prototype == "object" ? new.target.prototype : DerivedPrototype);
    Object.defineProperty(Derived, sym_deps, { value: new Map() });
    Object.defineProperty(Derived, sym_ders, { value: new Set() });
    Object.defineProperty(Derived, sym_weak, { value: new WeakRef(Derived) });
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
        for (const weak_derived of derivations) {
            const derived = weak_derived.deref();
            /* istanbul ignore next */
            if (derived) {
                derived[sym_deps].delete(this);
                delete derived[sym_value];
                invalidateDerivations(derived, false);
            } else {
                /* istanbul ignore next */
                derivations.delete(weak_derived);
            }
        }
        derivations.clear();
    }
});

function State(value, name) {
    if (!new.target) throw new TypeError("Constructor State requires 'new'");
    if (typeof name !== "string" || !name) name = "State";
    const State = ({[name]() {
        if (current_derived) {
            // add myself as a dependency of the current derivator
            current_derived[sym_deps].set(State, undefined);
            // add the current derivator as a derivation of myself
            State[sym_ders].add(current_derived[sym_weak]);
        }
        return State[sym_value];
    }})[name];
    Object.setPrototypeOf(State, typeof new.target.prototype == "object" ? new.target.prototype : StatePrototype);
    Object.defineProperty(State, sym_ders, { value: new Set() });
    State[sym_value] = value;
    return State;
}

State.prototype = StatePrototype;

//#endregion State

/** @param {Derived} target @param {boolean} transitive */
function invalidateDerivations(target, transitive) {
    /** @type {Map<unknown, unknown>} */
    const dependencies = target[sym_deps];
    /** @type {Set<WeakRef<Derived>>} */
    const derivations = target[sym_ders];
    if (
        (dependencies.size == 0 && derivations.size == 0)
        || recursiveDerivationInvalidationGuard.has(target)
    ) return;
    recursiveDerivationInvalidationGuard.add(target);
    for (const dependency of dependencies.keys()) {
        dependency[sym_ders].delete(target[sym_weak]);
    }
    dependencies.clear();
    for (const weak_derived of derivations) {
        const derived = weak_derived.deref();
        /* istanbul ignore next */
        if (derived) {
            derived[sym_deps].delete(target);
            delete derived[sym_value];
            invalidateDerivations(derived, true);
        } else {
            /* istanbul ignore next */
            derivations.delete(weak_derived);
        }
    }
    derivations.clear();
    recursiveDerivationInvalidationGuard.delete(target);
}

function defineProperties(target, properties) {
    for (const key in properties) {
        Object.defineProperty(target, key, { writable: true, configurable: true, value: properties[key] });
    }
    return target;
}

module.exports = {
    __proto__: null,
    Derived,
    State,
};
