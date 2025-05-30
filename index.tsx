import './index.css'

import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/components/App';

const app = async () => {

    const rootElement = document.createElement('div');
    document.body.appendChild(rootElement)
    // Create a root element

    let root = createRoot(rootElement);
    // Render the Login component
    root.render(
        <App/>
    );

}

app();