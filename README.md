# rubedo

A complete state management library, observe state changes without a compiler

rubedo is based on four classes, `State`, `Derived`, `Effect` and `Signal`

This package does not contain the jsx implementation, see [rubedo-dom](https://github.com/kernel32dev/rubedo-dom) for that

The idea is that you can define your state, how new data is derived from it and what it affects, and changes to the state will result in the expected deriveds and effects to update

Here is an example using rubedo-dom:

```tsx
function App() {
    const counter = new State(0);
    return (
        <div>
            <h1>Example counter</h1>
            <p>
                Current value: {counter}
            </p>
            <button onClick={() => counter.mut(x => x + 1)}>
                Increment
            </button>
        </div>
    );
}
```
