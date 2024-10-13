export interface Derived<out T> {
    (): T;
}
export const Derived: {
    new <T>(derivator: () => T): Derived<T>;
    prototype: Derived<any>,
};

export interface State<in out T> extends Derived<T> {
    set(value: T): void;
}
export const State: {
    new <T>(value: T): State<T>;
    prototype: State<any>,
};