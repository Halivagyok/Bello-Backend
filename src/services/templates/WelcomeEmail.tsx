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

interface WelcomeEmailProps {
  name: string;
}

export const WelcomeEmail = ({ name }: WelcomeEmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>Welcome to Bello!</Preview>
      <Tailwind>
        <Body style={main}>
          <Container style={container}>
            <Heading className="text-2xl font-bold text-gray-900 mb-4 text-center">
              Welcome to Bello, {name}! 🎉
            </Heading>
            <Text className="text-gray-700 text-base leading-relaxed mb-6">
              We're thrilled to have you here. Bello is designed to help you manage your projects effortlessly and seamlessly collaborate with your team.
            </Text>
            <Text className="text-gray-700 text-base leading-relaxed mb-6">
              Ready to get started? Head over to your dashboard to create your first project or board.
            </Text>
            <div className="text-center" style={{ textAlign: "center" }}>
                <Button 
                    href="http://localhost:5173/boards"
                    style={button}
                >
                    Get Started
                </Button>
            </div>
            <Text className="text-gray-500 text-sm mt-8 border-t border-gray-200 pt-6 text-center">
              If you have any questions, simply reply to this email. We're always here to help!
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

export default WelcomeEmail;
