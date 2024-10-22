import { Derived, State } from ".";

describe("State and Derived with caching and invalidation", () => {

    test("State should return the initial value", () => {
        const state = new State(10);
        expect(state()).toBe(10);
    });

    test("State should allow updating the value", () => {
        const state = new State(5);
        state.set(20);
        expect(state()).toBe(20);
    });

    test("Derived should cache computed value", () => {
        let callCount = 0;
        const state = new State(10);
        const derived = new Derived(() => {
            callCount++;
            return state() * 2;
        });

        // Should compute only once
        expect(derived()).toBe(20);
        expect(derived()).toBe(20);
        expect(callCount).toBe(1);
    });

    test("Derived should update when state changes", () => {
        const state = new State(10);
        const derived = new Derived(() => state() * 2);

        expect(derived()).toBe(20);

        // Invalidate and recompute
        state.set(15);
        expect(derived()).toBe(30);
    });

    test("Dependent derivators should not trigger if derived value is memoized", () => {
        const state1 = new State<number>(0);
        const mock2 = jest.fn(() => state1() >= 0);
        const derived2 = new Derived(mock2);
        const mock3 = jest.fn(() => derived2() ? "yes" : "no");
        const derived3 = new Derived(mock3);
        expect(mock2.mock.calls.length).toBe(0);
        expect(mock3.mock.calls.length).toBe(0);
        derived3();
        expect(mock2.mock.calls.length).toBe(1);
        expect(mock3.mock.calls.length).toBe(1);
        state1.set(-1); derived3();
        expect(mock2.mock.calls.length).toBe(2);
        expect(mock3.mock.calls.length).toBe(2);
        state1.set(1); derived3();
        expect(mock2.mock.calls.length).toBe(3);
        expect(mock3.mock.calls.length).toBe(3);
        state1.set(2); derived3();
        expect(mock2.mock.calls.length).toBe(4);
        expect(mock3.mock.calls.length).toBe(3); // derived3 
    });

    test("Derived can stop depending on derives", () => {
        const state1 = new State(true, "state1");
        const state2 = new State("yes", "state2");
        const state3 = new State("no", "state3");

        let derivedCallCount = 0;
        const derived = new Derived(() => {
            derivedCallCount++;
            return state1() ? state2() : state3();
        });


        // Initial calculation
        expect(derived()).toBe("yes");
        expect(derivedCallCount).toBe(1);

        // Invalidate state2, should need to call derivator
        state2.set("YES!");
        expect(derived()).toBe("YES!");
        expect(derivedCallCount).toBe(2);

        // Invalidate state3, should NOT need to call derivator
        state3.set("NO!");
        expect(derived()).toBe("YES!");
        expect(derivedCallCount).toBe(2);

        // Invalidate state1, should need to call derivator
        state1.set(false);
        expect(derived()).toBe("NO!");
        expect(derivedCallCount).toBe(3);

        // Invalidate state2, should NOT need to call derivator
        state2.set("YES?");
        expect(derived()).toBe("NO!");
        expect(derivedCallCount).toBe(3);

        // Invalidate state3, should need to call derivator
        state3.set("NO?");
        expect(derived()).toBe("NO?");
        expect(derivedCallCount).toBe(4);
    });
});

describe("State and Derived guards", () => {
    test("Constructor Derived requires 'new'", () => {
        expect(() => {
            //@ts-expect-error
            Derived(() => {});
        }).toThrow();
    });
    test("derivator is not a function", () => {
        expect(() => {
            //@ts-expect-error
            new Derived(1);
        }).toThrow();
    });
    test("Constructor State requires 'new'", () => {
        expect(() => {
            //@ts-expect-error
            State(1);
        }).toThrow();
    });
    test("Circular dependencies between derives should not cause infinite loops", () => {
        const derivedA = new Derived(() => {
            return derivedB();
        });

        const derivedB = new Derived(() => {
            return derivedA();
        });

        expect(() => {
            derivedA();
        }).toThrow();
    });
});
