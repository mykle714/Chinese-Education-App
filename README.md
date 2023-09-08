# Chinese-Education-App

## Tools to Install

| Tool Name                     | Version | Usage                                                                                                                                                                                                         | Installation                                                                                                                                                                                                                 |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code                       | Latest  | Dev Environment                                                                                                                                                                                               | https://code.visualstudio.com/Download                                                                                                                                                                                       |
| WSL                           | Latest  | Creates a Linux environment within your windows machine.                                                                                                                                                      | run `wsl --install` in powershell. You can use powershell from vscode or the actual powershell shell in Windows. <br /> https://learn.microsoft.com/en-us/windows/wsl/install                                                |
| nvm                           | Latest  | Node Version Manager helps you install & use different version of node.js.                                                                                                                                    | Go to the website and run either command under "Installing and Updating". Additionally, you can verify the installation by following the steps under the "Verify Installation" section. <br /> https://github.com/nvm-sh/nvm |
| npm                           | Latest  | npm is a software registry. This is where you'll get all your libraries from.                                                                                                                                 | run `nvm install node` This is from the "Usage" section in the nvm documentation.                                                                                                                                            |
| Typescript                    | Latest  | Typescript is the language we are using. It is a strictly typed version of javascript. It's helpful to make debugging easier and helps the IDE provide you with information.                                  | run `npm install typescript --save-dev` <br /> https://www.typescriptlang.org/download                                                                                                                                       |
| React                         | N/A     | React is what converts the Typescript JSX into normal Javascript. JSX is the markup code that you see in the Typescript code. React functions always return a single HTML tag.                                | N/A, React is already set up in the project.                                                                                                                                                                                 |
| Vite                          | N/A     | Vite builds the code and also automate setting up the project. To test, run `npm run dev` so that vite can host the project on your localhost. Vite will tell you which port it's on.                         | N/A, Vite is already set up in the project.                                                                                                                                                                                  |
| Bootstrap                     | N/A     | Bootstrap is a CSS library that you can leverage to create pre-styled components. Go to `https://getbootstrap.com/docs/5.3/getting-started/introduction/` to explore the various component styles they offer. | run `npm install` to install all dependancies in our project.                                                                                                                                                                |
| Material UI                   | N/A     | Material UI has a library of icons for public use. They also have prebuilt components, but we're not using any of them.                                                                                       | run `npm install` to install all dependancies in our project.                                                                                                                                                                |
| Git                           | Latest  | Version control                                                                                                                                                                                               | Do not download for Linux unless you have Linux. WSL is not a Virtual Machine, so you are still downloading for windows. <br /> https://git-scm.com/downloads                                                                |
| Github Personal Access Tokens | N/A     | Github requires Personal Access Tokens to authenticate.                                                                                                                                                       | Get your token from `https://github.com/settings/tokens` and give it to git when using git.                                                                                                                                  |

## VSCode extensions

| Extension Name | Usage                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| WSL            | Not strictly required but allows you to fully leverage WSL and be fully immersed in the Linux dev enviornment if you want.                     |
| ES7+           | Provides commands such as `rfce` within Typescript files to quickly lay down a template for a React component.                                 |
| Prettier       | Helps to make code easier to read with the added benefit of standardizing code formatting so that everyone learns how to read the same format. |

## Misc. Setup Steps

- Make sure to set Prettier as your designated formatter within VS Code. Also turn on format on save so that you don't have to force the format manually.
- Make WSL your default shell in VS Code
- After you run `npm install`, make sure your `vite.config.ts` file looks like the following. This is to ensure the hot updating occurs when using WSL.

```
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
   plugins: [react()],
   server: {
      watch: {
         usePolling: true
      }
   }
})

```

## Running & Testing

1. Clone `https://github.com/mykle714/Chinese-Education-App`
2. Run `npm install`
3. Update `vite.config.ts` as described above.
4. Run `npm run dev`
5. Wait for Vite to give you the local host
6. Click on the localhost link. This should automatically update when you save changes to the files you're editting.
