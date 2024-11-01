import { Effect, Derived, State } from ".";

/** await this promise to wait for all microtasks to complete */
const microtask = Promise.resolve();

function promiseWithResolvers<T>(): [Promise<T>, (value: T | PromiseLike<T>) => void, (error?: any) => void] {
    let f: (value: T | PromiseLike<T>) => void, r: (error?: any) => void;
    const p = new Promise<T>((resolve, reject) => { f = resolve; r = reject; });
    if (!f! || !r!) throw new Error("Promise did not run handler syncronously");
    return [p, f, r];
}

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
    test("State should allow transforming the value", () => {
        const state = new State(5);
        state.mut(x => x * 4);
        expect(state()).toBe(20);
    });
    test("Derived should cache computed value", () => {
        const state = new State(10);
        const mock = jest.fn(() => state() * 2);
        const derived = new Derived(mock);

        expect(mock).toHaveBeenCalledTimes(0);
        expect(derived()).toBe(20);
        expect(mock).toHaveBeenCalledTimes(1);
        expect(derived()).toBe(20);
        expect(mock).toHaveBeenCalledTimes(1);
    });
    test("Derived should update when state changes", () => {
        const state = new State(10);
        const derived = new Derived(() => state() * 2);

        expect(derived()).toBe(20);

        // Invalidate and recompute
        state.set(15);
        expect(derived()).toBe(30);
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
    test("State works with Derived", () => {
        const state = new State(1);
        expect(Derived.now(() => state())).toBe(1);
    });
    test("Derived works with Derived", () => {
        const derived = new Derived(() => 1);
        expect(Derived.now(() => derived())).toBe(1);
    });
});

describe("Derivation memoized (possibly invalidated mechanism)", () => {
    test("Dependent derivators should not trigger if derived value is memoized (intermediate refreshed lazily by derivation)", () => {
        const state1 = new State<number>(0);
        const mock2 = jest.fn(() => state1() >= 0);
        const derived2 = new Derived(mock2);
        const mock3 = jest.fn(() => derived2() ? "yes" : "no");
        const derived3 = new Derived(mock3);
        expect(mock2).toHaveBeenCalledTimes(0);
        expect(mock3).toHaveBeenCalledTimes(0);
        derived3();
        expect(mock2).toHaveBeenCalledTimes(1);
        expect(mock3).toHaveBeenCalledTimes(1);
        state1.set(-1);
        derived3();
        expect(mock2).toHaveBeenCalledTimes(2);
        expect(mock3).toHaveBeenCalledTimes(2);
        state1.set(1);
        derived3();
        expect(mock2).toHaveBeenCalledTimes(3);
        expect(mock3).toHaveBeenCalledTimes(3);
        state1.set(2);
        derived3();
        expect(mock2).toHaveBeenCalledTimes(4);
        expect(mock3).toHaveBeenCalledTimes(3);
        state1.set(3);
        derived3();
        expect(mock2).toHaveBeenCalledTimes(5);
        expect(mock3).toHaveBeenCalledTimes(3);
        state1.set(-4);
        derived3();
        expect(mock2).toHaveBeenCalledTimes(6);
        expect(mock3).toHaveBeenCalledTimes(4);
    });
    test("Dependent derivators should not trigger if derived value is memoized (intermediate refreshed actively)", () => {
        const state = new State("0");
        const mock1 = jest.fn(() => Number(state()));
        const derived1 = new Derived(mock1);
        const mock2 = jest.fn(() => derived1() == 0);
        const derived2 = new Derived(mock2);

        expect(mock1).toHaveBeenCalledTimes(0);
        expect(mock2).toHaveBeenCalledTimes(0);

        expect(derived1()).toBe(0);
        expect(derived2()).toBe(true);

        expect(mock1).toHaveBeenCalledTimes(1);
        expect(mock2).toHaveBeenCalledTimes(1);

        state.set("1");

        expect(derived1()).toBe(1);
        expect(derived2()).toBe(false);

        expect(mock1).toHaveBeenCalledTimes(2);
        expect(mock2).toHaveBeenCalledTimes(2);

        state.set("2");

        expect(derived1()).toBe(2);
        expect(derived2()).toBe(false);

        expect(mock1).toHaveBeenCalledTimes(3);
        expect(mock2).toHaveBeenCalledTimes(3);
    });
    test("Dependent derivators should not trigger if derived value is memoized (intermediate refreshed lazily by derivation) (with affector)", async () => {
        const state1 = new State<number>(0);
        const mock2 = jest.fn(() => state1() >= 0);
        const derived2 = new Derived(mock2);
        const mock3 = jest.fn(() => derived2() ? "yes" : "no");
        const derived3 = new Derived(mock3);

        expect(mock2).toHaveBeenCalledTimes(0);
        expect(mock3).toHaveBeenCalledTimes(0);

        const affects: ("yes" | "no")[] = [];
        function affector() { affects.push(derived3()); }
        new Effect(affects, affector);

        expect(mock2).toHaveBeenCalledTimes(1);
        expect(mock3).toHaveBeenCalledTimes(1);
        expect(affects).toEqual(["yes"]);
        await microtask;
        expect(mock2).toHaveBeenCalledTimes(1);
        expect(mock3).toHaveBeenCalledTimes(1);
        expect(affects).toEqual(["yes"]);
        state1.set(-1);
        await microtask;
        //expect(derived2()).toBe(false);
        //expect(derived3()).toBe("no");
        expect(mock2).toHaveBeenCalledTimes(2);
        expect(mock3).toHaveBeenCalledTimes(2);
        expect(affects).toEqual(["yes", "no"]);
        state1.set(1);
        await microtask;
        //expect(derived2()).toBe(true);
        //expect(derived3()).toBe("yes");
        expect(mock2).toHaveBeenCalledTimes(3);
        expect(mock3).toHaveBeenCalledTimes(3);
        expect(affects).toEqual(["yes", "no", "yes"]);
        state1.set(2);
        await microtask;
        //expect(derived2()).toBe(true);
        //expect(derived3()).toBe("yes");
        expect(mock2).toHaveBeenCalledTimes(4);
        expect(mock3).toHaveBeenCalledTimes(3);
        expect(affects).toEqual(["yes", "no", "yes"]);
        state1.set(3);
        await microtask;
        //expect(derived2()).toBe(true);
        //expect(derived3()).toBe("yes");
        expect(mock2).toHaveBeenCalledTimes(5);
        expect(mock3).toHaveBeenCalledTimes(3);
        expect(affects).toEqual(["yes", "no", "yes"]);
        state1.set(-4);
        await microtask;
        expect(mock2).toHaveBeenCalledTimes(6);
        expect(mock3).toHaveBeenCalledTimes(4);
        expect(affects).toEqual(["yes", "no", "yes", "no"]);
    });
    test("Dependent derivators should not trigger if derived value is memoized (intermediate refreshed actively) (with affector)", async () => {
        const state = new State("0");
        const mock1 = jest.fn(() => Number(state()));
        const derived1 = new Derived(mock1);
        const mock2 = jest.fn(() => derived1() == 0);
        const derived2 = new Derived(mock2);

        expect(mock1).toHaveBeenCalledTimes(0);
        expect(mock2).toHaveBeenCalledTimes(0);

        expect(derived1()).toBe(0);
        expect(derived2()).toBe(true);

        const affects: boolean[] = [];
        function affector() { affects.push(derived2()); }
        new Effect(affects, affector);

        expect(mock1).toHaveBeenCalledTimes(1);
        expect(mock2).toHaveBeenCalledTimes(1);
        expect(affects).toEqual([true]);

        state.set("1");

        expect(derived1()).toBe(1);
        expect(derived2()).toBe(false);
        await microtask;

        expect(mock1).toHaveBeenCalledTimes(2);
        expect(mock2).toHaveBeenCalledTimes(2);
        expect(affects).toEqual([true, false]);

        state.set("2");

        expect(derived1()).toBe(2);
        expect(derived2()).toBe(false);
        await microtask;

        expect(mock1).toHaveBeenCalledTimes(3);
        expect(mock2).toHaveBeenCalledTimes(3);
        expect(affects).toEqual([true, false]);
    });
});

describe("special State objects", () => {
    describe("State.view", () => {
        test("State.view should create a state view for an object's property", () => {
            const target = {
                username: "initial_user",
                password: "initial_pass"
            };

            // Create a view state for the username property
            const usernameState = State.view(target, "username");

            // Check that it reads the correct initial value
            expect(usernameState()).toBe("initial_user");

            // Modify the view state and check if it updates the target object property
            usernameState.set("updated_user");
            expect(target.username).toBe("updated_user");

            // Update the target object property directly and check if the view reflects the change
            target.username = "direct_update";
            expect(usernameState()).toBe("direct_update");
        });
        test("State.view should only affect the specified property", () => {
            const target = {
                username: "user",
                email: "user@example.com"
            };

            // Create a view state for the username property
            const usernameState = State.view(target, "username");

            // Modify the view state
            usernameState.set("new_user");

            // Check that only the username property was modified
            expect(target.username).toBe("new_user");
            expect(target.email).toBe("user@example.com");
        });
    });

    describe("State.proxy", () => {
        test("State.proxy should use custom getter and setter functions", () => {
            let actualValue = 100;

            // Define getter and setter functions for the proxy state
            const getter = jest.fn(() => actualValue);
            const setter = jest.fn((value) => {
                actualValue = value;
            });

            // Create the proxy state
            const proxyState = State.proxy(getter, setter);

            // Test the initial value via the proxy's getter
            expect(proxyState()).toBe(100);
            expect(getter).toHaveBeenCalledTimes(1);

            // Test setting a new value via the proxy's setter
            proxyState.set(200);
            expect(setter).toHaveBeenCalledWith(200);
            expect(actualValue).toBe(200);

            // Check that getter reflects the updated value
            expect(proxyState()).toBe(200);
            expect(getter).toHaveBeenCalledTimes(2);
        });
        test("State.proxy should not interfere with unrelated state", () => {
            let proxyValue = "proxy_initial";
            const getter = () => proxyValue;
            const setter = (value: string) => { proxyValue = value; };

            // Create a separate state
            const independentState = new State("independent");
            const proxyState = State.proxy(getter, setter);

            // Modify the proxy and independent states
            proxyState.set("proxy_updated");
            independentState.set("new_independent");

            // Verify that each state reflects only its own changes
            expect(proxyState()).toBe("proxy_updated");
            expect(independentState()).toBe("new_independent");
        });
    });
});

describe("Derived static helpers", () => {
    test("Derived.from with value", () => {
        const derived = Derived.from(3);
        expect(derived()).toBe(3);
        expect(derived.name).toBe("Derived");
    });
    test("Derived.from with derived", () => {
        const derived = Derived.from(new Derived("custom", () => 3));
        expect(derived()).toBe(3);
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
            derivedA();
        }).toThrow();
    });
    test("affector is not a function", () => {
        expect(() => {
            //@ts-expect-error
            affect("everything", 1);
        }).toThrow();
        expect(() => {
            //@ts-expect-error
            affect.clear(1);
        }).toThrow();
    });
    describe("can't track object that is not extensible", () => {
        test("State.track object", () => {
            const x = Object.preventExtensions({});
            expect(() => {
                State.track(x);
            }).toThrow();
        });
        test("State.track array", () => {
            const x = Object.preventExtensions([]);
            expect(() => {
                State.track(x);
            }).toThrow();
        });
        test("State.track promise", () => {
            const x = Object.preventExtensions(new Promise(() => { }));
            expect(() => {
                State.track(x);
            }).toThrow();
        });
        test("State.freeze object", () => {
            const x = Object.preventExtensions({});
            expect(() => {
                State.freeze(x);
            }).toThrow();
        });
        test("State.freeze array", () => {
            const x = Object.preventExtensions([]);
            expect(() => {
                State.freeze(x);
            }).toThrow();
        });
        test("State.freeze promise", () => {
            const x = Object.preventExtensions(new Promise(() => { }));
            expect(() => {
                State.freeze(x);
            }).toThrow();
        });
    });
});

if (false) describe("derivation region guards", () => {
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
    test("State.prototype should throw when inside derivation", () => {
        const state = new State(1);
        const derived = new Derived(() => state());
        expect(() => {
            derived();
        }).toThrow();
    });
    test("Derived.prototype should throw when inside derivation", () => {
        const derivedA = new Derived(() => 1);
        const derivedB = new Derived(() => derivedA());
        expect(() => {
            derivedB();
        }).toThrow();
    });
    test("State.prototype should throw when inside now", () => {
        const state = new State(1);
        expect(() => {
            Derived.now(() => {
                state();
            });
        }).toThrow();
    });
    test("Derived.prototype should throw when inside now", () => {
        const derived = new Derived(() => 1);
        expect(() => {
            Derived.now(() => {
                derived();
            });
        }).toThrow();
    });
});

describe("affect", () => {
    test("affecting on State changes", async () => {
        const effects: number[] = [];
        const state = new State(0);
        const affector = new Effect(effects, () => {
            effects.push(state());
        });
        expect(effects).toEqual([0]);
        state.set(1);
        await microtask;
        expect(effects).toEqual([0, 1]);
        state.set(2);
        await microtask;
        expect(effects).toEqual([0, 1, 2]);
        affector.clear();
        state.set(3);
        await microtask;
        expect(effects).toEqual([0, 1, 2]);
    });
    test("affecting on Derived changes", async () => {
        const effects: string[] = [];
        const state = new State(0);
        const derived = new Derived(() => String(state()));
        const affector = new Effect(effects, () => {
            effects.push(derived());
        });
        expect(effects).toEqual(["0"]);
        state.set(1);
        await microtask;
        expect(effects).toEqual(["0", "1"]);
        state.set(2);
        await microtask;
        expect(effects).toEqual(["0", "1", "2"]);
        affector.clear();
        state.set(3);
        await microtask;
        expect(effects).toEqual(["0", "1", "2"]);
    });
    test("can clear affect during handler", async () => {
        const trigger = new State<number | null>(null);
        const affected = new State<string | null>(null);
        new Effect(affected, affector => {
            if (trigger() == null) return;
            affector.clear();
            const value = trigger(); // use trigger after clear
            affected.set(String(value));
        });
        expect(trigger()).toBe(null);
        expect(affected()).toBe(null);
        await microtask;
        expect(trigger()).toBe(null);
        expect(affected()).toBe(null);

        trigger.set(100);
        await microtask;
        expect(trigger()).toBe(100);
        expect(affected()).toBe("100");

        trigger.set(200); // invalidate trigger after the clear
        await microtask;
        expect(trigger()).toBe(200);
        expect(affected()).toBe("100");
    });
});

describe("tracked object", () => {
    test("derivation notice changes in TrackedObject", () => {
        const obj = new State.Object() as { property?: number };
        const derived = new Derived(() => obj.property);
        expect(derived()).toBe(undefined);
        obj.property = 1;
        expect(derived()).toBe(1);
    });
    test("derivation notice changes in tracked object medwith track", () => {
        const obj = State.track({}) as { property?: number };
        const derived = new Derived(() => obj.property);
        expect(derived()).toBe(undefined);
        obj.property = 1;
        expect(derived()).toBe(1);
    });
});

describe("tracked array", () => {
    test("derivation notice changes to length", () => {
        const arr = State.track([]) as number[];
        const derived = new Derived(() => arr.length);
        expect(derived()).toBe(0);
        arr.push(0, 0, 0);
        expect(derived()).toBe(3);
    });
    test("derivation notice changes to item", () => {
        const arr = State.track([0]) as number[];
        const derived = new Derived(() => arr[0]);
        expect(derived()).toBe(0);
        arr[0] = 3;
        expect(derived()).toBe(3);
    });
    test("naive map works", () => {
        const arr = State.track([0]) as number[];
        const derived = new Derived(() => arr.map(String));
        expect(derived()).toEqual(["0"]);
        arr[0] = 3;
        expect(derived()).toEqual(["3"]);
    });
    test("derived map works", () => {
        const arr = State.track([0, 1, 2]) as number[];
        const mock = jest.fn(String);
        const derived = arr.$map(mock);
        expect(mock).toHaveBeenCalledTimes(0);
        expect([...derived]).toEqual(["0", "1", "2"]);
        expect(mock).toHaveBeenCalledTimes(3);
        arr[0] = 3;
        expect(mock).toHaveBeenCalledTimes(3);
        expect([...derived]).toEqual(["3", "1", "2"]);
        expect(mock).toHaveBeenCalledTimes(4);
    });
    test("double derived map works", () => {
        const arr = State.track([0, 1, 2]) as number[];
        const mock = jest.fn(String);
        const derived = arr.$map(mock).$map(Number);
        expect(mock).toHaveBeenCalledTimes(0);
        expect([...derived]).toEqual([0, 1, 2]);
        expect(mock).toHaveBeenCalledTimes(3);
        arr[0] = 3;
        expect(mock).toHaveBeenCalledTimes(3);
        expect([...derived]).toEqual([3, 1, 2]);
        expect(mock).toHaveBeenCalledTimes(4);
    });
    test("derivation notice on clear array", () => {
        const arr = State.track([1, 2, 3]) as number[];
        const derived = new Derived(() => arr.length);
        expect(derived()).toBe(3);

        arr.length = 0;  // Clear the array
        expect(derived()).toBe(0);
    });
    test("derivation notice on specific item change", () => {
        const arr = State.track([1, 2, 3]) as number[];
        const derived = new Derived(() => arr[1]);  // Observe the second item
        expect(derived()).toBe(2);

        arr[1] = 42;  // Change second item
        expect(derived()).toBe(42);
    });
    test("push and pop operations", () => {
        const arr = State.track([1, 2, 3]) as number[];
        const derived = new Derived(() => arr.slice());
        expect(derived()).toEqual([1, 2, 3]);

        arr.push(4);  // Push an item
        expect(derived()).toEqual([1, 2, 3, 4]);

        arr.pop();  // Pop the last item
        expect(derived()).toEqual([1, 2, 3]);
    });
    test("shift and unshift operations", () => {
        const arr = State.track([1, 2, 3]) as number[];
        const derived = new Derived(() => arr.slice());
        expect(derived()).toEqual([1, 2, 3]);

        arr.unshift(0);  // Add an item at the start
        expect(derived()).toEqual([0, 1, 2, 3]);

        arr.shift();  // Remove the first item
        expect(derived()).toEqual([1, 2, 3]);
    });
    test("filter derivation works", () => {
        const arr = State.track([1, 2, 3, 4, 5]) as number[];
        const derived = new Derived(() => arr.filter(x => x % 2 === 0));  // Track only even numbers
        expect(derived()).toEqual([2, 4]);

        arr.push(6);  // Add another even number
        expect(derived()).toEqual([2, 4, 6]);

        arr[1] = 7;  // Change an even number to an odd number
        expect(derived()).toEqual([4, 6]);
    });
    test("reduce derivation works", () => {
        const arr = State.track([1, 2, 3]) as number[];
        const derived = new Derived(() => arr.reduce((acc, x) => acc + x, 0));  // Sum of elements
        expect(derived()).toBe(6);

        arr[1] = 5;  // Change a number in the array
        expect(derived()).toBe(9);

        arr.push(1);  // Add another element
        expect(derived()).toBe(10);
    });
    test("complex chain of map and filter", () => {
        const arr = State.track([1, 2, 3, 4, 5, 6]) as number[];
        const derived = new Derived(() => arr.filter(x => x % 2 === 0).map(x => x * 2));  // Double even numbers
        expect(derived()).toEqual([4, 8, 12]);

        arr.push(7, 8);  // Add an odd and an even number
        expect(derived()).toEqual([4, 8, 12, 16]);

        arr[1] = 10;  // Change an even number
        expect(derived()).toEqual([20, 8, 12, 16]);
    });
    test("sorting derivation works", () => {
        const arr = State.track([3, 1, 4, 1, 5]) as number[];
        const derived = new Derived(() => [...arr].sort((a, b) => a - b));  // Sort ascending
        expect(derived()).toEqual([1, 1, 3, 4, 5]);

        arr[0] = 2;  // Change an element
        expect(derived()).toEqual([1, 1, 2, 4, 5]);
    });
    test("reversing derivation works", () => {
        const arr = State.track([1, 2, 3]) as number[];
        const derived = new Derived(() => [...arr].reverse());  // Reverse the array
        expect(derived()).toEqual([3, 2, 1]);

        arr.push(4);  // Add an item
        expect(derived()).toEqual([4, 3, 2, 1]);
    });
});

describe("tracked promise", () => {
    test("$resolved notifies derived", async () => {
        const [p, f, r] = promiseWithResolvers<number>();
        const resolved = new Derived(() => p.$resolved());
        expect(resolved()).toBe(false);
        f(100);
        expect(resolved()).toBe(false);
        await microtask;
        expect(resolved()).toBe(true);
    });
    test("$rejected notifies derived", async () => {
        const [p, f, r] = promiseWithResolvers<number>();
        const rejected = new Derived(() => p.$rejected());
        expect(rejected()).toBe(false);
        r("reason");
        expect(rejected()).toBe(false);
        await microtask;
        expect(rejected()).toBe(true);
    });
    test("$value notifies derived", async () => {
        const [p, f, r] = promiseWithResolvers<number>();
        const resolved = new Derived(() => p.$value);
        expect(resolved()).toBe(undefined);
        f(100);
        expect(resolved()).toBe(undefined);
        await microtask;
        expect(resolved()).toBe(100);
    });
    test("$error notifies derived", async () => {
        const [p, f, r] = promiseWithResolvers<number>();
        const rejected = new Derived(() => p.$error);
        expect(rejected()).toBe(undefined);
        r("reason");
        expect(rejected()).toBe(undefined);
        await microtask;
        expect(rejected()).toBe("reason");
    });
});

describe("State.is", () => {
    test("frozen objects compare equal", () => {
        const is = State.is;
        const a = State.freeze({ first: 1, second: 2, third: 3 });
        const b = State.freeze({ second: 2, first: 1, third: 3 });
        const c = State.freeze({ first: 1, third: 3 });
        expect(is(a, a)).toBe(true);
        expect(is(b, b)).toBe(true);
        expect(is(c, c)).toBe(true);
    
        expect(is(a, b)).toBe(true);
        expect(is(b, a)).toBe(true);
        expect(is(b, c)).toBe(false);
        expect(is(c, b)).toBe(false);
        expect(is(a, c)).toBe(false);
        expect(is(c, a)).toBe(false);
    });
    test("recursive objects may return unequal", () => {
        type RecursiveObject = {head:string, tail: RecursiveObject | null };

        const a: RecursiveObject = { head: "value", tail: null };
        a.tail = a;

        const b: RecursiveObject = { head: "value", tail: null };
        b.tail = b;

        State.freeze(a);
        State.freeze(b);

        expect(State.is(a, b)).toBe(false);
    });
});