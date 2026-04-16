import nodemailer from 'nodemailer';
import { render } from '@react-email/render';
import React from 'react';
import WelcomeEmail from './templates/WelcomeEmail';
import ResetPasswordEmail from './templates/ResetPasswordEmail';
import InviteEmail from './templates/InviteEmail';

// Create a transporter using environment variables. 
// If they are missing, it will log a warning and not crash, but sending will fail.
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
    },
});

const defaultFrom = process.env.SMTP_FROM || '"Bello" <noreply@bello.hu>';

export const sendWelcomeEmail = async (to: string, name: string) => {
    if (!process.env.SMTP_HOST) {
        console.warn('SMTP_HOST not set. Mocking Welcome Email to', to);
        return;
    }

    try {
        const html = await render(React.createElement(WelcomeEmail, { name }));

        await transporter.sendMail({
            from: defaultFrom,
            to,
            subject: 'Welcome to Bello!',
            html,
        });
        console.log(`Welcome email sent to ${to}`);
    } catch (error) {
        console.error('Error sending welcome email:', error);
    }
};

export const sendResetPasswordEmail = async (to: string, name: string, token: string) => {
    if (!process.env.SMTP_HOST) {
        console.warn('SMTP_HOST not set. Mocking Reset Password Email to', to, 'with token', token);
        return;
    }

    try {
        const frontEndUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const resetLink = `${frontEndUrl}/reset-password?token=${token}`;

        const html = await render(React.createElement(ResetPasswordEmail, { name, resetLink }));

        await transporter.sendMail({
            from: defaultFrom,
            to,
            subject: 'Reset your Bello Password',
            html,
        });
        console.log(`Reset password email sent to ${to}`);
    } catch (error) {
        console.error('Error sending reset password email:', error);
    }
};

export const sendInviteEmail = async (to: string, inviterName: string, projectName: string, role: string, projectId: string) => {
    if (!process.env.SMTP_HOST) {
        console.warn('SMTP_HOST not set. Mocking Invite Email to', to);
        return;
    }

    try {
        const html = await render(React.createElement(InviteEmail, { inviterName, projectName, role, projectId }));

        await transporter.sendMail({
            from: defaultFrom,
            to,
            subject: `You've been invited to ${projectName}`,
            html,
        });
        console.log(`Invite email sent to ${to}`);
    } catch (error) {
        console.error('Error sending invite email:', error);
    }
};
