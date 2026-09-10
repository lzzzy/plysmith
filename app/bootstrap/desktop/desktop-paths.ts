import path from 'node:path';

const desktopPathOptions = new Set(['--application-home', '--install-root']);

export function selectDesktopArguments(
  processArguments: readonly string[],
): readonly string[] {
  const firstDesktopOption = processArguments.findIndex((argument) =>
    desktopPathOptions.has(argument),
  );
  return firstDesktopOption < 0
    ? []
    : processArguments.slice(firstDesktopOption);
}

export function parseDesktopPaths(arguments_: readonly string[]): {
  applicationHome: string;
  installRoot: string;
} {
  let applicationHome = path.resolve('.');
  let installRoot = path.resolve('.');

  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (
      desktopPathOptions.has(option ?? '') &&
      value !== undefined &&
      value.trim().length > 0 &&
      !value.startsWith('--')
    ) {
      if (option === '--application-home') {
        applicationHome = path.resolve(value);
      } else {
        installRoot = path.resolve(value);
      }
      index += 1;
      continue;
    }
    throw new Error(
      'Expected --application-home or --install-root with a directory.',
    );
  }
  return { applicationHome, installRoot };
}
