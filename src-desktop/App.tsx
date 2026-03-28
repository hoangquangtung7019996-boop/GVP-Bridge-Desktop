// TODO: Implement SolidJS UI
//
// Requirements:
// 1. Show textarea for prompt input
// 2. Show current status ("Ready", "Connected", "Sent ✓", "Error: ...")
// 3. Connect to Tauri backend via invoke()
// 4. On load, check if WebSocket server is running
// 5. Provide visual feedback when prompt is sent
//
// See PROJECT_CONTEXT.md for specs

import { createSignal, onMount } from 'solid-js';
import { invoke } from '@tauri-apps/api/tauri';

export default function App() {
    // TODO: Create reactive signals
    // const [prompt, setPrompt] = createSignal('');
    // const [status, setStatus] = createSignal('Ready');
    // const [connected, setConnected] = createSignal(false);

    // TODO: Implement onMount to check connection
    
    // TODO: Implement sendPrompt function that calls invoke('set_prompt', { prompt })

    return (
        <div class="app">
            {/* TODO: Implement UI
                - Header with title
                - Prompt textarea
                - Status indicator
                - Optional: Connection indicator
            */}
            <h1>GVP Quick Raw</h1>
            <p>IMPLEMENTATION NEEDED - See PROJECT_CONTEXT.md</p>
        </div>
    );
}
