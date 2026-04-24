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

interface InviteEmailProps {
  inviterName: string;
  projectName: string;
  role: string;
  projectId: string;
  url: string;
}

export const InviteEmail = ({ inviterName, projectName, role, projectId, url }: InviteEmailProps) => {
  const inviteLink = `${url}/projects/${projectId}`;

  return (
    <Html>
      <Head />
      <Preview>You have been invited to join a project on Bello</Preview>
      <Tailwind>
        <Body style={main}>
          <Container style={container}>
            <Heading className="text-2xl font-bold text-gray-900 mb-4 text-center">
              You've been invited!
            </Heading>
            <Text className="text-gray-700 text-base leading-relaxed mb-6 text-center">
              <strong>{inviterName}</strong> has invited you to join the <strong>{projectName}</strong> project on Bello as a <strong>{role}</strong>.
            </Text>
            <div className="text-center" style={{ textAlign: "center" }}>
                <Button 
                    href={inviteLink}
                    style={button}
                >
                    View Project
                </Button>
            </div>
            <Text className="text-gray-500 text-sm border-t border-gray-200 pt-6 text-center">
              If you don't have an account on Bello yet, you will be able to create one and automatically join the project using this link.
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

export default InviteEmail;
