import { describe, expect, it } from "vitest";
import { parseEmail, parsePhone, parseUsPhoneDigits, spreadDigits, formatPhone, US_ONLY_MESSAGE } from "../identifier";

// docs/LOGIN_REWORK.md Q9–Q10: separate Email and Phone fields.
describe("parseEmail", () => {
    it("reads an email, trimmed and lowercased", () => {
        expect(parseEmail("  Mei@Example.COM ")).toEqual({ kind: "email", value: "mei@example.com" });
    });
    it("rejects malformed input", () => {
        expect(parseEmail("").kind).toBe("invalid");
        expect(parseEmail("mei@").kind).toBe("invalid");
        expect(parseEmail("hello").kind).toBe("invalid");
        expect(parseEmail("+15551234567").kind).toBe("invalid");
    });
});

describe("parsePhone", () => {
    it("reads an E.164 phone, stripping separators", () => {
        expect(parsePhone("+1 (555) 123-4567")).toEqual({ kind: "phone", value: "+15551234567" });
        expect(parsePhone("+886 912.345.678")).toEqual({ kind: "phone", value: "+886912345678" });
    });
    it("never guesses a country", () => {
        expect(parsePhone("555 123 4567")).toEqual({ kind: "invalid", message: "Start with + and your country code, e.g. +1 555 123 4567" });
    });
    it("rejects malformed input", () => {
        expect(parsePhone("").kind).toBe("invalid");
        expect(parsePhone("+12").kind).toBe("invalid");
        expect(parsePhone("mei@example.com").kind).toBe("invalid");
    });
});

const empty = () => Array<string>(10).fill("");

describe("spreadDigits", () => {
    it("puts a typed digit in its box and moves on", () => {
        const boxes = ["5", "5", "5", "", "", "", "", "", "", ""];
        expect(spreadDigits(boxes, 3, "7")).toEqual({ boxes: ["5", "5", "5", "7", "", "", "", "", "", ""], focus: 4 });
    });
    it("never starts past the first empty box", () => {
        expect(spreadDigits(empty(), 6, "7")).toEqual({ boxes: ["7", "", "", "", "", "", "", "", "", ""], focus: 1 });
        expect(spreadDigits(["5", "5", "", "", "", "", "", "", "", ""], 8, "34").boxes.slice(0, 5)).toEqual(["5", "5", "3", "4", ""]);
    });
    it("retypes a filled box in place", () => {
        const full = "5551234567".split("");
        expect(spreadDigits(full, 4, "9").boxes.join("")).toBe("5551934567");
    });
    it("drops a 0 or 1 typed into the first box (the habitual country code)", () => {
        expect(spreadDigits(empty(), 0, "1")).toEqual({ boxes: empty(), focus: 0 });
        expect(spreadDigits(empty(), 0, "0")).toEqual({ boxes: empty(), focus: 0 });
        expect(spreadDigits(empty(), 0, "15").boxes[0]).toBe("5");
        // Later boxes take a 0 or 1 as usual.
        expect(spreadDigits(["5", "", "", "", "", "", "", "", "", ""], 1, "1").boxes[1]).toBe("1");
    });
    it("fills every box from the first on a pasted or autofilled number, dropping the +1", () => {
        const all = "5551234567".split("");
        expect(spreadDigits(empty(), 6, "+1 (555) 123-4567")).toEqual({ boxes: all, focus: 9 });
        expect(spreadDigits(empty(), 4, "555.123.4567")).toEqual({ boxes: all, focus: 9 });
    });
    it("fills forward from the box on a short paste, stopping at the last box", () => {
        const eight = ["5", "5", "5", "2", "2", "2", "3", "3", "", ""];
        expect(spreadDigits(eight, 8, "123").boxes.slice(8)).toEqual(["1", "2"]);
    });
    it("ignores non-digits", () => {
        expect(spreadDigits(empty(), 0, "a")).toEqual({ boxes: empty(), focus: 0 });
    });
});

describe("parseUsPhoneDigits", () => {
    it("reads ten digits as a +1 number", () => {
        expect(parseUsPhoneDigits("2125550123".split(""))).toEqual({ kind: "phone", value: "+12125550123" });
    });
    it("asks for all ten", () => {
        expect(parseUsPhoneDigits(empty())).toEqual({ kind: "invalid", message: "Enter your phone number" });
        expect(parseUsPhoneDigits(["5", "5", "5", "", "", "", "", "", "", ""])).toEqual({ kind: "invalid", message: "Enter all 10 digits" });
    });
    it("rejects an area code or exchange starting with 0 or 1, saying which countries work", () => {
        expect(parseUsPhoneDigits("1212555012".split(""))).toEqual({ kind: "invalid", message: US_ONLY_MESSAGE }); // the leading 1 pasted in
        expect(parseUsPhoneDigits("2120550123".split("")).kind).toBe("invalid"); // exchange 055
        expect(parseUsPhoneDigits("2121550123".split("")).kind).toBe("invalid"); // exchange 155
    });
});

describe("formatPhone", () => {
    it("writes a +1 number the US way and leaves others alone", () => {
        expect(formatPhone("+12125550123")).toBe("+1 (212) 555-0123");
        expect(formatPhone("+886912345678")).toBe("+886912345678");
    });
});
