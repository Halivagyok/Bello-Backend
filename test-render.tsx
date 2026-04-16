import { render } from '@react-email/render';
import React from 'react';
import WelcomeEmail from './src/services/templates/WelcomeEmail';

async function test() {
    try {
        const html = await render(React.createElement(WelcomeEmail, { name: 'Test' }));
        console.log("RENDER SUCCESS!");
        console.log(html.substring(0, 100));
    } catch (e) {
        console.error("RENDER FAILED:", e);
    }
}
test();
