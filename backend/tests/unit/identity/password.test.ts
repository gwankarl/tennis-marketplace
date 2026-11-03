import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPasswordService } from '../../../src/modules/identity/passwords/password.service.js';

const TEST_PASSWORD = '  Correct Horse Battery Staple  ';

function sha1(value: string): string {
  return createHash('sha1').update(value, 'utf8').digest('hex').toUpperCase();
}

function responseWith(body: string, status = 200): Response {
  return new Response(body, { status });
}

function otherSuffix(expectedSuffix: string): string {
  const firstCharacter = expectedSuffix[0] === 'A' ? 'B' : 'A';
  return `${firstCharacter}${expectedSuffix.slice(1)}`;
}

async function expectUnavailable(
  fetchImplementation: typeof fetch,
  timeoutMs = 50,
): Promise<void> {
  const service = createPasswordService(fetchImplementation, timeoutMs);

  await expect(service.screenPassword(TEST_PASSWORD)).rejects.toMatchObject({
    name: 'ApplicationError',
    code: 'SERVICE_UNAVAILABLE',
    message: 'Password screening is temporarily unavailable.',
  });
}

describe('password hashing', () => {
  it('verifies the correct password and rejects an incorrect password', async () => {
    const service = createPasswordService();
    const passwordHash = await service.hashPassword(TEST_PASSWORD);

    await expect(
      service.verifyPassword(passwordHash, TEST_PASSWORD),
    ).resolves.toBe(true);
    await expect(
      service.verifyPassword(passwordHash, 'a different password'),
    ).resolves.toBe(false);
  });

  it('uses Argon2id settings and independent library-generated salts', async () => {
    const service = createPasswordService();
    const firstHash = await service.hashPassword(TEST_PASSWORD);
    const secondHash = await service.hashPassword(TEST_PASSWORD);

    const argon2idHashPattern =
      /^\$argon2id\$v=19\$([^$]+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;

    const firstMatch = argon2idHashPattern.exec(firstHash);
    const secondMatch = argon2idHashPattern.exec(secondHash);

    expect(firstMatch).not.toBeNull();
    expect(secondMatch).not.toBeNull();

    for (const match of [firstMatch, secondMatch]) {
      const parameters = new Map(
        match![1].split(',').map((parameter) => {
          const [key, value] = parameter.split('=');
          return [key, value];
        }),
      );

      expect(parameters.get('m')).toBe('19456');
      expect(parameters.get('t')).toBe('2');
      expect(parameters.get('p')).toBe('1');
    }

    expect(firstMatch![2]).not.toBe(secondMatch![2]);
  });
});

describe('HIBP password screening', () => {
  it('rejects a positive-count suffix match', async () => {
    const expectedSuffix = sha1(TEST_PASSWORD).slice(5);
    const fetchImplementation: typeof fetch = async () =>
      responseWith(`${expectedSuffix}:1`);

    const service = createPasswordService(fetchImplementation);

    await expect(service.screenPassword(TEST_PASSWORD)).resolves.toBe(
      'compromised',
    );
  });

  it('returns clear when the suffix does not match', async () => {
    const expectedSuffix = sha1(TEST_PASSWORD).slice(5);
    const fetchImplementation: typeof fetch = async () =>
      responseWith(`${otherSuffix(expectedSuffix)}:12`);

    const service = createPasswordService(fetchImplementation);

    await expect(service.screenPassword(TEST_PASSWORD)).resolves.toBe('clear');
  });

  it('treats a matching zero-count padding row as clear', async () => {
    const expectedSuffix = sha1(TEST_PASSWORD).slice(5);
    const fetchImplementation: typeof fetch = async () =>
      responseWith(`${expectedSuffix}:0`);

    const service = createPasswordService(fetchImplementation);

    await expect(service.screenPassword(TEST_PASSWORD)).resolves.toBe('clear');
  });

  it('sends only the five-character prefix and requests padded results', async () => {
    const expectedHash = sha1(TEST_PASSWORD);
    let requestUrl = '';
    let requestInit: RequestInit | undefined;

    const fetchImplementation: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return responseWith(`${otherSuffix(expectedHash.slice(5))}:1`);
    };

    const service = createPasswordService(fetchImplementation);

    await expect(service.screenPassword(TEST_PASSWORD)).resolves.toBe('clear');

    expect(requestUrl).toBe(
      `https://api.pwnedpasswords.com/range/${expectedHash.slice(0, 5)}`,
    );
    expect(requestUrl).not.toContain(expectedHash.slice(5));
    expect(requestUrl).not.toContain(TEST_PASSWORD);
    expect(requestInit?.redirect).toBe('error');

    const headers = new Headers(requestInit?.headers);
    expect(headers.get('Add-Padding')).toBe('true');
    expect(headers.get('user-agent')).toBe('Tennis-Xpress/0.1');
  });

  it('preserves the password exactly during the lookup', async () => {
    const exactPassword = '  Mixed Case Password  ';
    const expectedHash = sha1(exactPassword);
    let requestUrl = '';

    const fetchImplementation: typeof fetch = async (input) => {
      requestUrl = String(input);
      return responseWith(`${otherSuffix(expectedHash.slice(5))}:1`);
    };

    const service = createPasswordService(fetchImplementation);

    await expect(service.screenPassword(exactPassword)).resolves.toBe('clear');
    expect(requestUrl).toBe(
      `https://api.pwnedpasswords.com/range/${expectedHash.slice(0, 5)}`,
    );
  });

  it('maps network failures to a safe temporary-unavailable error', async () => {
    const fetchImplementation: typeof fetch = async () => {
      throw new Error(
        'https://user:token-secret@private.invalid/?password=secret',
      );
    };

    await expectUnavailable(fetchImplementation);
  });

  it('maps unsuccessful HTTP statuses to a safe temporary-unavailable error', async () => {
    const fetchImplementation: typeof fetch = async () =>
      responseWith('private response body', 503);

    await expectUnavailable(fetchImplementation);
  });

  it('maps malformed response rows to a safe temporary-unavailable error', async () => {
    const fetchImplementation: typeof fetch = async () =>
      responseWith('not-a-valid-suffix:1');

    await expectUnavailable(fetchImplementation);
  });

  it('maps malformed UTF-8 response bodies to a safe temporary-unavailable error', async () => {
    const fetchImplementation: typeof fetch = async () =>
      new Response(new Uint8Array([0xc3, 0x28]), { status: 200 });

    await expectUnavailable(fetchImplementation);
  });

  it('maps oversized response bodies to a safe temporary-unavailable error', async () => {
    const oversizedBody = 'A'.repeat(128 * 1024 + 1);
    const fetchImplementation: typeof fetch = async () =>
      responseWith(oversizedBody);

    await expectUnavailable(fetchImplementation);
  });

  it('maps request timeouts to a safe temporary-unavailable error', async () => {
    const fetchImplementation: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new Error('private timeout details')),
          { once: true },
        );
      });

    await expectUnavailable(fetchImplementation, 10);
  });

  it('keeps the timeout active while reading a stalled response body', async () => {
    const fetchImplementation: typeof fetch = async (_input, init) => {
      const signal = init?.signal;

      if (!signal) {
        throw new Error('Expected an abort signal.');
      }

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener(
            'abort',
            () => controller.error(new Error('private body timeout details')),
            { once: true },
          );
        },
      });

      return new Response(body, { status: 200 });
    };

    await expectUnavailable(fetchImplementation, 10);
  });
});
