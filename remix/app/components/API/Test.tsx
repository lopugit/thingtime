import { Suspense } from 'react';
import { Box, Flex, Button, Spacer } from '@chakra-ui/react';
import { Editor } from '../Editor/Editor';
import { TopSpacing } from '../Layout/TopSpacing';

export const TestAPI = (props) => {
  const defaultValueDefault = `
    {
      "username": "thingtime",
      "password": "password"
    }
  `;

  const { defaultValue = defaultValueDefault } = props;

  const run = () => {};

  const controls = (
    <>
      <Flex my={6}>
        <Button onClick={run}>Test</Button>
      </Flex>
    </>
  );

  return (
    <>
      {controls}
      <Editor></Editor>
      {controls}
    </>
  );
};
