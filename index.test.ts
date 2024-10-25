import { Derived, ignore, react, State } from ".";

describe("State and Derived with caching and invalidation", () => {
    test("State should return the initial value", () => {
        const state = new State(10);
        expect(state.now()).toBe(10);
    });

    test("State should allow updating the value", () => {
        const state = new State(5);
        state.set(20);
        expect(state.now()).toBe(20);
    });

    test("Derived should cache computed value", () => {
        let callCount = 0;
        const state = new State(10);
        const derived = new Derived(() => {
            callCount++;
            return state() * 2;
        });

        // Should compute only once
        expect(derived.now()).toBe(20);
        expect(derived.now()).toBe(20);
        expect(callCount).toBe(1);
    });

    test("Derived should update when state changes", () => {
        const state = new State(10);
        const derived = new Derived(() => state() * 2);

        expect(derived.now()).toBe(20);

        // Invalidate and recompute
        state.set(15);
        expect(derived.now()).toBe(30);
    });

    test("Dependent derivators should not trigger if derived value is memoized", () => {
        const state1 = new State<number>(0);
        const mock2 = jest.fn(() => state1() >= 0);
        const derived2 = new Derived(mock2);
        const mock3 = jest.fn(() => derived2() ? "yes" : "no");
        const derived3 = new Derived(mock3);
        expect(mock2.mock.calls.length).toBe(0);
        expect(mock3.mock.calls.length).toBe(0);
        derived3.now();
        expect(mock2.mock.calls.length).toBe(1);
        expect(mock3.mock.calls.length).toBe(1);
        state1.set(-1); derived3.now();
        expect(mock2.mock.calls.length).toBe(2);
        expect(mock3.mock.calls.length).toBe(2);
        state1.set(1); derived3.now();
        expect(mock2.mock.calls.length).toBe(3);
        expect(mock3.mock.calls.length).toBe(3);
        state1.set(2); derived3.now();
        expect(mock2.mock.calls.length).toBe(4);
        expect(mock3.mock.calls.length).toBe(3); // derived3 
    });

    test("Derived can stop depending on derives", () => {
        const state1 = new State("state1", true);
        const state2 = new State("state2", "yes");
        const state3 = new State("state3", "no");

        let derivedCallCount = 0;
        const derived = new Derived(() => {
            derivedCallCount++;
            return state1() ? state2() : state3();
        });

        // Initial calculation
        expect(derived.now()).toBe("yes");
        expect(derivedCallCount).toBe(1);

        // Invalidate state2, should need to call derivator
        state2.set("YES!");
        expect(derived.now()).toBe("YES!");
        expect(derivedCallCount).toBe(2);

        // Invalidate state3, should NOT need to call derivator
        state3.set("NO!");
        expect(derived.now()).toBe("YES!");
        expect(derivedCallCount).toBe(2);

        // Invalidate state1, should need to call derivator
        state1.set(false);
        expect(derived.now()).toBe("NO!");
        expect(derivedCallCount).toBe(3);

        // Invalidate state2, should NOT need to call derivator
        state2.set("YES?");
        expect(derived.now()).toBe("NO!");
        expect(derivedCallCount).toBe(3);

        // Invalidate state3, should need to call derivator
        state3.set("NO?");
        expect(derived.now()).toBe("NO?");
        expect(derivedCallCount).toBe(4);
    });
    test("State works with Derived.now", () => {
        const state = new State(1);
        expect(Derived.now(() => state())).toBe(1);
    });
    test("Derived works with Derived.now", () => {
        const derived = new Derived(() => 1);
        expect(Derived.now(() => derived())).toBe(1);
    });
});

describe("Derived static helpers", () => {
    test("Derived.from with value", () => {
        const derived = Derived.from(3);
        expect(derived.now()).toBe(3);
        expect(derived.name).toBe("Derived");
    });
    test("Derived.from with derived", () => {
        const derived = Derived.from(new Derived("custom", () => 3));
        expect(derived.now()).toBe(3);
        expect(derived.name).toBe("custom");
    });
    test("Derived.use with value", () => {
        Derived.now(() => {
            const derived = Derived.use(3);
            expect(derived).toBe(3);
        });
    });
    test("Derived.use with derived", () => {
        Derived.now(() => {
            const derived = Derived.use(new Derived(() => 3));
            expect(derived).toBe(3);
        });
    });
});

describe("type guards", () => {
    test("Constructor Derived requires 'new'", () => {
        expect(() => {
            //@ts-expect-error
            Derived(() => { });
        }).toThrow();
    });
    test("derivator is not a function", () => {
        expect(() => {
            //@ts-expect-error
            new Derived(1);
        }).toThrow();
        expect(() => {
            //@ts-expect-error
            new Derived("custom", 1);
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
            derivedA.now();
        }).toThrow();
    });
    test("affector is not a function", () => {
        expect(() => {
            //@ts-expect-error
            react(1);
        }).toThrow();
        expect(() => {
            //@ts-expect-error
            ignore(1);
        }).toThrow();
    });
});

describe("derivation region guards", () => {
    test("calling State should throw when outside derivation", () => {
        const state = new State(1);
        expect(() => {
            state();
        }).toThrow();
    });
    test("calling Derived should throw when outside derivation", () => {
        const derived = new Derived(() => 1);
        expect(() => {
            derived();
        }).toThrow();
    });
    test("State.prototype.now should throw when inside derivation", () => {
        const state = new State(1);
        const derived = new Derived(() => state.now());
        expect(() => {
            derived.now();
        }).toThrow();
    });
    test("Derived.prototype.now should throw when inside derivation", () => {
        const derivedA = new Derived(() => 1);
        const derivedB = new Derived(() => derivedA.now());
        expect(() => {
            derivedB.now();
        }).toThrow();
    });
    test("State.prototype.now should throw when inside now", () => {
        const state = new State(1);
        expect(() => {
            Derived.now(() => {
                state.now();
            });
        }).toThrow();
    });
    test("Derived.prototype.now should throw when inside now", () => {
        const derived = new Derived(() => 1);
        expect(() => {
            Derived.now(() => {
                derived.now();
            });
        }).toThrow();
    });
});

describe("react", () => {
    test("reacting to State changes", async () => {
        const effects: number[] = [];
        const state = new State(0);
        const affector = react(() => {
            effects.push(state());
        });
        expect(effects).toEqual([0]);
        state.set(1);
        await waitMicrotask;
        expect(effects).toEqual([0, 1]);
        state.set(2);
        await waitMicrotask;
        expect(effects).toEqual([0, 1, 2]);
        ignore(affector);
        state.set(3);
        await waitMicrotask;
        expect(effects).toEqual([0, 1, 2]);
    });
    test("reacting to Derived changes", async () => {
        const effects: string[] = [];
        const state = new State(0);
        const derived = new Derived(() => String(state()));
        const affector = react(() => {
            effects.push(derived());
        });
        expect(effects).toEqual(["0"]);
        state.set(1);
        await waitMicrotask;
        expect(effects).toEqual(["0", "1"]);
        state.set(2);
        await waitMicrotask;
        expect(effects).toEqual(["0", "1", "2"]);
        ignore(affector);
        state.set(3);
        await waitMicrotask;
        expect(effects).toEqual(["0", "1", "2"]);
    });
});

/** await this promise to wait for all microtasks to complete */
const waitMicrotask = Promise.resolve();
