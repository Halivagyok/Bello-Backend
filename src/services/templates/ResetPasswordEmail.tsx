import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
  Tailwind,
  Button
} from '@react-email/components';

interface ResetPasswordEmailProps {
  name: string;
  resetLink: string;
}

export const ResetPasswordEmail = ({ name, resetLink }: ResetPasswordEmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>Reset your Bello password</Preview>
      <Tailwind>
        <Body style={main}>
          <Container style={container}>
            <Heading className="text-2xl font-bold text-gray-900 mb-4 text-center">
              Password Reset Request
            </Heading>
            <Text className="text-gray-700 text-base leading-relaxed mb-6">
              Hi {name},
            </Text>
            <Text className="text-gray-700 text-base leading-relaxed mb-6">
              We received a request to reset your password for your Bello account. Click the button below to choose a new password. This link will expire in 1 hour.
            </Text>
            <div className="text-center" style={{ textAlign: "center" }}>
                <Button 
                    href={resetLink}
                    style={button}
                >
                    Reset Password
                </Button>
            </div>
            <Text className="text-gray-500 text-sm border-t border-gray-200 pt-6 text-center">
              If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

const main = {
  backgroundColor: '#f3f4f6',
  fontFamily: 'sans-serif',
  padding: '40px 0',
};

const container = {
  backgroundColor: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  margin: '0 auto',
  padding: '32px',
  width: '100%',
  maxWidth: '600px',
};

const button = {
  backgroundColor: '#000000',
  color: '#ffffff',
  borderRadius: '6px',
  padding: '12px 24px',
  fontWeight: '600',
  textAlign: 'center' as const,
  display: 'inline-block',
  marginTop: '8px',
  marginBottom: '24px',
  textDecoration: 'none',
};

export default ResetPasswordEmail;
