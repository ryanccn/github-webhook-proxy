const hex = (data: Uint8Array) => {
	return [...data].map((x) => x.toString(16).padStart(2, "0")).join("");
};

export const validate = async ({
	data,
	signature,
	secret,
}: {
	data: ArrayBuffer | ArrayBufferLike;
	signature: string;
	secret: string;
}) => {
	const enc = new TextEncoder();

	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		{
			name: "HMAC",
			hash: { name: "SHA-256" },
		},
		false,
		["sign", "verify"],
	);

	const actualSignature = await crypto.subtle.sign("HMAC", key, data);

	const actualSignatureHex = hex(new Uint8Array(actualSignature));
	return "sha256=" + actualSignatureHex === signature;
};

export const generateSecret = () => {
	const data = new Uint8Array(32);
	crypto.getRandomValues(data);

	return hex(data);
};
