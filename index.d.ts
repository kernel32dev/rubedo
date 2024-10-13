export interface Derived<out T> {
    (): T;
    name: string;
}
export const Derived: {
    new <T>(derivator: () => T, name?: string): Derived<T>;
    prototype: Derived<any>,
};

export interface State<in out T> extends Derived<T> {
    set(value: T): void;
}
export const State: {
    new <T>(value: T, name?: string): State<T>;
    prototype: State<any>,
};