/**
 * GVP Bridge - Entry Point
 * Mounts the SolidJS application
 */

import { render } from 'solid-js/web';
import App from './App';
import './styles.css';

const root = document.getElementById('root');

if (root) {
    render(() => <App />, root);
} else {
    console.error('Failed to find root element');
}
