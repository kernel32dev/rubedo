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

    test("Dependent derivators should not trigger if derived value does not change", () => {
        const state = new State(10);
        let derived1CallCount = 0;
        const derived1 = new Derived(() => {
            derived1CallCount++;
            return state() > 5 ? 100 : 50;
        });
        
        let derived2CallCount = 0;
        const derived2 = new Derived(() => {
            derived2CallCount++;
            return derived1() + 10;
        });

        // Initial calculation
        expect(derived2()).toBe(110);
        expect(derived1CallCount).toBe(1);
        expect(derived2CallCount).toBe(1);

        // State changes, but derived1 value doesn't change
        state.set(11);
        expect(derived2()).toBe(110);
        expect(derived1CallCount).toBe(2);
        expect(derived2CallCount).toBe(2); // No change in derived1, so derived2 is not recalculated

        // State changes, derived1 changes, and derived2 should recalculate
        state.set(4);
        expect(derived2()).toBe(60);
        expect(derived1CallCount).toBe(3);
        expect(derived2CallCount).toBe(3); // No change in derived1, so derived2 is not recalculated

        // TODO! change the test above to actually test if derived2 is not called redundantly
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
