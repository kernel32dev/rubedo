
/** the dependencies of this object, if they are invalidated so am i, present only on derived objects */
const sym_deps = Symbol("deps");

/** the derivations of this object (Derived objects that depend on this) */
const sym_ders = Symbol("ders");

/** the value of this object, exists only on State */
const sym_value = Symbol("value");

//#region Derived

const DerivedPrototype = {__proto__: Function.prototype};

function Derived(derivator) {
    if (!new.target) throw new TypeError("Constructor Derived requires 'new'");
    if (typeof derivator !== "function") throw new TypeError("derivator is not a function");
    function Derived() {
        if (!(sym_value in Derived)) {
            // TODO! capture dependencies
            Derived[sym_value] = derivator();
        }
        return Derived[sym_value];
    }
    Object.setPrototypeOf(Derived, typeof new.target.prototype == "object" ? new.target.prototype : DerivedPrototype);
    return Derived;
}

Derived.prototype = DerivedPrototype;

//#endregion Derived
//#region State

const StatePrototype = define_properties({__proto__: DerivedPrototype}, {
    set(value) {
        // TODO! invalidate derivations
        this[sym_value] = value;
    }
});

function State(value) {
    if (!new.target) throw new TypeError("Constructor State requires 'new'");
    function State() {
        return State[sym_value];
    }
    Object.setPrototypeOf(State, typeof new.target.prototype == "object" ? new.target.prototype : StatePrototype);
    State[sym_value] = value;
    return State;
}

State.prototype = StatePrototype;

//#endregion State

function define_properties(target, properties) {
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
