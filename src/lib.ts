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
		["sign", "verify"]
	);

	const actualSignature = await crypto.subtle.sign("HMAC", key, data);

	const actualSignatureHex = [...new Uint8Array(actualSignature)]
		.map((x) => x.toString(16).padStart(2, "0"))
		.join("");

	return actualSignatureHex === signature;
};
