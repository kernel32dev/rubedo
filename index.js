
const sym_value = Symbol("value");

function define_properties(target, properties) {
    for (const key in properties) {
        Object.defineProperty(target, key, { writable: true, configurable: true, value: properties[key] });
    }
    return target;
}

module.exports = {
    __proto__: null,
};
