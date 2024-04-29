import { checkUserExists } from "~/api/utils/checkUserExists";

export default function Index() {
  return <div>Login</div>;
}

export const action = async ({ request }) => {
  
  console.log('nik request', request);
  
  // get remix action body
  
  const body = await request.json();
  
  const { username, password } = body;
  
  console.log('nik body', body)
  
  console.log('nik username', username);
  console.log('nik password', password);
  
  
  return {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      message: 'Hello, World!',
      username,
      password
    },
    cache: {
      revalidate: 60
    }
  };
};
