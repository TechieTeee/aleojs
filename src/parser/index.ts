import fs from 'fs';
import path from 'path';

import { Tokenizer } from './tokenizer';
import { Parser } from './parser';

import { Generator } from '../generator/generator';
import { getProjectRoot, pathFromRoot, writeToFile } from '../utils/fs-utils';
import {
  PROGRAM_DIRECTORY,
  GENERATE_FILE_OUT_DIR
} from '../generator/string-constants';

// Generate Import/Export code for index file from definitions and filename
// definition has an item which can be function or types
function generateIndexFileCode(
  declaredImports: { importName?: string; filename?: string }[]
): string {
  // Create individual import statement according to type/function definition and filename
  declaredImports = declaredImports.filter((item) => {
    return item.importName && item.importName?.trim() !== '';
  });

  const code = declaredImports
    .map(
      (imports) =>
        `import { ${imports.importName} } from "./${imports.filename}";\n`
    )
    .join('');

  // Create a single line export statement from all the declared type/functions
  const exportItems = declaredImports
    .map((item) => item?.importName)
    .join(', ');
  return code.concat(`\nexport { ${exportItems} }`);
}

function convertEnvToKeyVal(envData: string): Map<string, string> {
  envData = envData.trim();
  const envVariables = envData.split('\n');
  return new Map<string, string>(
    envVariables.map((variable) => {
      const keyVal = variable.split('=');
      if (keyVal.length !== 2)
        throw new Error('Invalid Environment declaration: ' + keyVal);
      return [keyVal[0], keyVal[1]];
    })
  );
}

// Read file
async function parseAleo(programFolder: string) {
  try {
    // Check if build directory exists
    if (!fs.existsSync(programFolder + 'build')) return;

    const inputFile = programFolder + 'build/main.aleo';

    console.log(`Parsing program[${inputFile}]`);

    const data = fs.readFileSync(inputFile, 'utf-8');
    const tokenizer = new Tokenizer(data);
    const aleoReflection = new Parser(tokenizer).parse();

    // Parse .env for private key
    const envFile = programFolder + '/.env';
    const envData = fs.readFileSync(envFile, 'utf-8');
    aleoReflection.env = convertEnvToKeyVal(envData);
    console.log('Available Environment Variables: ', aleoReflection.env);

    // Create Output Directory
    const outputFolder = pathFromRoot(GENERATE_FILE_OUT_DIR);
    if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder);

    const programName = aleoReflection.programName;
    const outputFile = `${programName}.ts`;

    const generator = new Generator(aleoReflection);
    if (aleoReflection.customTypes.length === 0) {
      console.warn(
        `No types generated for program: ${programName}. No custom types[struct/record] declaration found`
      );
    } else {
      await Promise.all([
        writeToFile(
          `${outputFolder}types/${outputFile}`,
          generator.generateTypes()
        ),
        writeToFile(
          `${outputFolder}leo2js/${outputFile}`,
          generator.generateLeoToJS()
        ),
        writeToFile(
          `${outputFolder}js2leo/${outputFile}`,
          generator.generateJSToLeo()
        )
      ]);
    }

    await writeToFile(
      `${outputFolder}${outputFile}`,
      generator.generatedTransitionFunctions()
    );

    return {
      types: generator.generatedTypes,
      js2LeoFn: generator.generatedJS2LeoFn,
      leo2jsFn: generator.generatedLeo2JSFn,
      programName
    };
  } catch (error) {
    console.log(error);
  }
}

async function compilePrograms() {
  try {
    const projectRoot = getProjectRoot();
    const programPath = path.join(projectRoot, PROGRAM_DIRECTORY);
    const outputPath = path.join(projectRoot, GENERATE_FILE_OUT_DIR);

    const contents = fs.readdirSync(programPath);
    const folders = contents.filter((name) =>
      fs.statSync(programPath + name).isDirectory()
    );

    // Create Output Directory
    if (!fs.existsSync(outputPath)) fs.mkdirSync(outputPath);

    const result = await Promise.all(
      folders.map((program) => parseAleo(programPath + program + '/'))
    );

    const typesIndexFileData = generateIndexFileCode(
      result.map((elm) => {
        return {
          importName: elm?.types.join(', '),
          filename: elm?.programName
        };
      })
    );

    // Create import for leo2ts/index.ts file
    const leo2jsIndexFileData = generateIndexFileCode(
      result.map((elm) => {
        return {
          importName: elm?.leo2jsFn.join(', '),
          filename: elm?.programName
        };
      })
    );

    // Create import for js2leo/index.ts file
    const js2leoIndexFileData = generateIndexFileCode(
      result.map((elm) => {
        return {
          importName: elm?.js2LeoFn.join(', '),
          filename: elm?.programName
        };
      })
    );

    await Promise.all([
      writeToFile(path.join(outputPath, 'types/index.ts'), typesIndexFileData),
      writeToFile(
        path.join(outputPath, 'leo2js/index.ts'),
        leo2jsIndexFileData
      ),
      writeToFile(path.join(outputPath, 'js2leo/index.ts'), js2leoIndexFileData)
    ]);
  } catch (error) {
    console.log(error);
  }
}

export { compilePrograms };
