#!/usr/bin/env python3
import os
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
                                Image, Table, TableStyle, PageBreak, ListFlowable, ListItem,
                                KeepTogether)
from PIL import Image as PILImage

UP = "/root/.claude/uploads/2149434c-f192-5736-be44-d8295ef8d508"
OUT = "/home/user/srcsolar-build/SOP_Panel_Scanner_Midway.pdf"
LOGO = os.path.join(UP, "1b8f823a-31674.png")

ORANGE = colors.HexColor("#F97316")
INK = colors.HexColor("#1a1a2e")
GREY = colors.HexColor("#6b6b6b")
LIGHT = colors.HexColor("#f3efe9")

COMPANY = "Sun Rise Construction and Development LLC"
AUTHOR = "Dustin Hanson"
DATE = "June 22, 2026"
PROJECT = "Midway — Afton, Virginia"

styles = getSampleStyleSheet()
def S(name, **kw):
    base = kw.pop("parent", styles["Normal"])
    return ParagraphStyle(name, parent=base, **kw)

body = S("body", fontName="Helvetica", fontSize=10.5, leading=15, textColor=INK, spaceAfter=6)
h1 = S("h1", fontName="Helvetica-Bold", fontSize=16, leading=20, textColor=INK, spaceBefore=10, spaceAfter=8)
h2 = S("h2", fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=ORANGE, spaceBefore=8, spaceAfter=4)
cap = S("cap", fontName="Helvetica-Oblique", fontSize=8.5, leading=11, textColor=GREY, alignment=TA_CENTER, spaceAfter=10)
li = S("li", parent=body, leftIndent=4, spaceAfter=3)

def img_scaled(path, max_w, max_h):
    iw, ih = PILImage.open(path).size
    r = min(max_w/iw, max_h/ih)
    return Image(path, width=iw*r, height=ih*r)

def figure(fname, caption, max_w=2.3*inch, max_h=4.4*inch):
    p = os.path.join(UP, fname)
    if not os.path.exists(p):
        return Spacer(1, 2)
    im = img_scaled(p, max_w, max_h)
    im.hAlign = "CENTER"
    return KeepTogether([Spacer(1,4), im, Spacer(1,3), Paragraph(caption, cap)])

def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, li), leftIndent=14, value="•") for t in items],
                        bulletType="bullet", start="•", leftIndent=10)

def steps(items):
    return ListFlowable([ListItem(Paragraph(t, li), leftIndent=16) for t in items],
                        bulletType="1", leftIndent=12)

story = []

# ---------- Title page ----------
story.append(Spacer(1, 0.5*inch))
logo = img_scaled(LOGO, 3.1*inch, 3.1*inch); logo.hAlign = "CENTER"
story.append(logo)
story.append(Spacer(1, 0.3*inch))
story.append(Paragraph("STANDARD OPERATING PROCEDURE", S("t1", fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=INK, alignment=TA_CENTER)))
story.append(Spacer(1, 6))
story.append(Paragraph("Solar Panel Barcode Scanning &amp; Quality Control", S("t2", fontName="Helvetica", fontSize=14, leading=18, textColor=ORANGE, alignment=TA_CENTER)))
story.append(Spacer(1, 0.4*inch))
meta = Table([
    ["Company", COMPANY],
    ["Author", AUTHOR],
    ["Date", DATE],
    ["Project", PROJECT],
    ["Application", "Panel Scanner (web app)"],
    ["Document", "SOP-PS-001"],
    ["Version", "1.0"],
], colWidths=[1.4*inch, 4.1*inch])
meta.setStyle(TableStyle([
    ("FONT", (0,0), (0,-1), "Helvetica-Bold", 10),
    ("FONT", (1,0), (1,-1), "Helvetica", 10),
    ("TEXTCOLOR", (0,0), (0,-1), ORANGE),
    ("TEXTCOLOR", (1,0), (1,-1), INK),
    ("ROWBACKGROUNDS", (0,0), (-1,-1), [colors.white, LIGHT]),
    ("BOX", (0,0), (-1,-1), 0.5, colors.HexColor("#d9d2c7")),
    ("INNERGRID", (0,0), (-1,-1), 0.5, colors.HexColor("#e6e0d6")),
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
    ("LEFTPADDING", (0,0), (-1,-1), 10),
    ("TOPPADDING", (0,0), (-1,-1), 7),
    ("BOTTOMPADDING", (0,0), (-1,-1), 7),
]))
meta.hAlign = "CENTER"
story.append(meta)
story.append(PageBreak())

# ---------- 1. Purpose ----------
story.append(Paragraph("1. Purpose", h1))
story.append(Paragraph(
    "This procedure defines how field crews record and quality-check solar module (panel) serial numbers "
    "for the <b>Midway</b> project in Afton, Virginia using the Panel Scanner web application. Following this "
    "SOP ensures every installed panel is captured against its physical location (section &amp; row), that a "
    "photo of each barcode is retained, and that a minimum of <b>10% of all panels</b> are independently "
    "re-scanned for quality control.", body))

story.append(Paragraph("2. Scope", h1))
story.append(Paragraph(
    "Applies to all personnel of " + COMPANY + " who scan, log, review, or QC solar panels on the Midway site. "
    "It covers device setup, scanning, manual entry, review/correction, the 10% QC re-scan, and the automatic "
    "Google Sheets export.", body))

story.append(Paragraph("3. Definitions", h1))
story.append(bullets([
    "<b>Project</b> — the job site (e.g., Midway). Each project gets its own Google Sheet automatically.",
    "<b>Section</b> — a block/area within the project. Each section becomes its own tab in the sheet.",
    "<b>Row</b> — a row of panels within a section. Each row has an expected panel count.",
    "<b>Panel</b> — a single module; one scanned barcode = one panel entry, numbered within its row.",
    "<b>Operator</b> — the person scanning; their name is attached to every entry (no login required).",
    "<b>QC</b> — Quality Control: a second, independent scan of a panel's barcode that must match the original.",
]))

story.append(Paragraph("4. System Overview", h1))
story.append(Paragraph(
    "The Panel Scanner is a mobile-first web app (works on Android &amp; iPhone). It requires no login — the "
    "operator simply enters their name. Scans are saved instantly to a central store, multiple people can work "
    "the same project at once, and every scan is mirrored to a Google Sheet in the company Drive. No app "
    "install is needed; it runs in the phone's web browser over HTTPS.", body))

story.append(PageBreak())

# ---------- 5. Getting started ----------
story.append(Paragraph("5. Getting Started", h1))
story.append(steps([
    "Open the scanner link in your phone browser (e.g., the company scan tool URL). Tip: add it to your home screen.",
    "When prompted, enter <b>your name</b> and tap <b>Start Scanning</b>. Your name is tied to every panel you log.",
    "Allow <b>camera access</b> when the browser asks — it is required for scanning.",
]))
story.append(Paragraph("6. Project, Section &amp; Row Setup", h1))
story.append(Paragraph(
    "Before scanning, make sure the project structure exists. On Midway, scanners select the existing project, "
    "section, and row. Supervisors create these as needed:", body))
story.append(steps([
    "Tap the <b>Midway</b> project (or <b>+ New Project</b> to create it).",
    "Open a <b>Section</b> (or <b>+ New Section</b>, e.g., “Section 1”). Each section is its own sheet tab.",
    "Open a <b>Row</b> (or <b>+ New Row</b>) and set the <b>expected panel count</b> for that row.",
]))
story.append(figure("29e7616b-38714.jpg", "Figure 1 — Project view. Tap a section to open its rows; create new ones with the dashed tile."))

story.append(PageBreak())

# ---------- 7. Scanning ----------
story.append(Paragraph("7. Scanning Panels", h1))
story.append(Paragraph("With a row open, scanning is automatic and hands-free:", body))
story.append(steps([
    "Tap <b>Start Scanning</b> to open the in-app viewfinder (a slim barcode band).",
    "Center the panel's barcode in the band. It reads automatically — no shutter button.",
    "On a successful read the screen flashes a green <b>✓ COMPLETE</b>, beeps/vibrates, captures the barcode "
    "photo, and advances to the next panel number automatically.",
    "Continue down the row. The panel counter increments for you.",
]))
story.append(Paragraph("Helpful behaviors", h2))
story.append(bullets([
    "<b>Steady capture</b> (on by default): briefly shows <b>HOLD STEADY…</b> to grab the sharpest photo. "
    "Hold the phone still for that moment.",
    "<b>Duplicate guard</b>: if a serial was already logged in the row, you get a <b>Duplicate Serial</b> "
    "warning — choose <i>Skip</i> or <i>Add Anyway</i>.",
    "<b>Over-target warning</b>: scanning beyond the row's expected count prompts <b>Row Already Full</b> — "
    "<i>Add Extra Panel</i>, <i>Finish Row</i>, or <i>Cancel</i>.",
    "<b>Completeness</b>: finishing a row prompts to start the next row; finishing all rows prompts a new section. "
    "Missing panel numbers are flagged before you move on.",
    "<b>Can't read a barcode?</b> Tap <b>Enter manually</b> to type the serial. (In photo mode, a failed read "
    "prompts <i>Retake Photo</i> or <i>Enter Manually</i> — the app never guesses a serial.)",
]))
story.append(figure("1a0be9f3-38847.jpg", "Figure 2 — A captured panel with its barcode photo and decoded serial."))

story.append(PageBreak())

# ---------- 8. Review ----------
story.append(Paragraph("8. Reviewing &amp; Correcting Entries", h1))
story.append(Paragraph(
    "Tap any logged panel to open the review view. Use <b>← Prev</b> / <b>Next →</b> to step through the row, "
    "check each photo against its serial, edit the serial or panel number if needed, and tap <b>Save Edits</b>. "
    "Corrections update the central record and the Google Sheet (the matching row is replaced, not duplicated).", body))
story.append(figure("abc606ea-38767.jpg", "Figure 3 — Panel review view: photo, serial, panel number, and actions."))

# ---------- 9. QC ----------
story.append(Paragraph("9. Quality Control — 10% Re-Scan", h1))
story.append(Paragraph(
    "At least <b>10% of all logged panels</b> must be independently re-scanned. The project screen shows a "
    "<b>QC review</b> banner with progress toward the target (e.g., 1,770 of ~17,700 panels). To perform a QC check:", body))
story.append(steps([
    "Open a panel in the review view (Section 8).",
    "Tap <b>🔁 QC Scan (scan again)</b> and re-scan the same physical barcode.",
    "If the re-scan <b>matches</b> the original serial, the panel is marked <b>QC PASS</b> and the app advances "
    "to the next panel.",
    "If it <b>does not match</b>, the panel is marked <b>QC FAIL</b> and shows what was scanned — investigate and "
    "correct the record.",
]))
story.append(bullets([
    "Each QC result writes to the Google Sheet: the second scan value, the Pass/Fail result, and (on Pass) an "
    "embedded image of the barcode.",
    "Spread QC across sections/rows and operators so the 10% sample is representative.",
]))

story.append(PageBreak())

# ---------- 10. Sheets ----------
story.append(Paragraph("10. Google Sheets Export", h1))
story.append(Paragraph(
    "Every scan, correction, and QC result is sent to a Google Sheet in the company Drive. The app "
    "<b>auto-creates one spreadsheet per project</b> (in a “Panel Scanner” Drive folder), with <b>one tab per "
    "section</b>. Each row contains:", body))
cols = Table([
    ["Section", "Row", "Panel", "Serial", "By"],
    ["Project", "Timestamp", "QC Scan", "QC Verified", "QC Photo"],
], colWidths=[1.1*inch]*5)
cols.setStyle(TableStyle([
    ("FONT", (0,0), (-1,-1), "Helvetica", 9),
    ("TEXTCOLOR", (0,0), (-1,-1), INK),
    ("BACKGROUND", (0,0), (-1,-1), LIGHT),
    ("BOX", (0,0), (-1,-1), 0.5, colors.HexColor("#d9d2c7")),
    ("INNERGRID", (0,0), (-1,-1), 0.5, colors.HexColor("#e6e0d6")),
    ("ALIGN", (0,0), (-1,-1), "CENTER"),
    ("TOPPADDING", (0,0), (-1,-1), 6), ("BOTTOMPADDING", (0,0), (-1,-1), 6),
]))
story.append(cols)
story.append(Spacer(1, 8))
story.append(Paragraph("One-time setup (supervisor / admin)", h2))
story.append(steps([
    "In the scanner, open <b>⚙ Settings</b> and tap <b>📋 Copy script</b>.",
    "Go to <b>script.google.com → New project</b>, delete the sample, paste the script, and Save.",
    "<b>Deploy → New deployment → Web app</b>; set <i>Execute as: Me</i> and <i>Who has access: Anyone</i>; authorize Drive/Sheets access.",
    "Copy the Web app URL (ends in <b>/exec</b>) and paste it into the scanner's Settings, then Save.",
    "Scan a panel — the project's spreadsheet appears automatically in your Drive.",
]))
story.append(figure("18d09939-38740.jpg", "Figure 4 — Settings: paste the Apps Script Web App URL for Google Sheets sync.", max_w=2.2*inch, max_h=3.9*inch))
story.append(figure("60da7a4b-38779.jpg", "Figure 5 — Google Apps Script web app deployment.", max_w=2.2*inch, max_h=3.9*inch))

story.append(PageBreak())

# ---------- 11. Roles ----------
story.append(Paragraph("11. Roles &amp; Concurrent Use", h1))
story.append(bullets([
    "<b>Operators</b> scan panels; their name is recorded on every entry. Multiple operators can scan the same "
    "project simultaneously.",
    "<b>QC reviewers</b> perform the 10% re-scan checks and resolve any QC FAIL items.",
    "<b>Supervisor/Admin</b> maintains the project/section/row layout and the Google Sheets connection.",
]))
story.append(Paragraph("12. Troubleshooting", h1))
story.append(bullets([
    "<b>Camera won't open</b> — ensure browser camera permission is allowed and you're on HTTPS; reload the page.",
    "<b>Barcode won't read</b> — improve lighting, fill the band with the label, hold steady; or use <b>Enter manually</b>.",
    "<b>A button seems unresponsive after an update</b> — hard-refresh the page to load the latest version.",
    "<b>Sheet not updating</b> — confirm the Apps Script Web App URL is saved in Settings and deployed as “Anyone”.",
]))
story.append(Paragraph("13. Revision History", h1))
rev = Table([
    ["Version", "Date", "Author", "Description"],
    ["1.0", DATE, AUTHOR, "Initial release."],
], colWidths=[0.8*inch, 1.3*inch, 1.5*inch, 2.4*inch])
rev.setStyle(TableStyle([
    ("FONT", (0,0), (-1,0), "Helvetica-Bold", 9.5),
    ("FONT", (0,1), (-1,-1), "Helvetica", 9.5),
    ("BACKGROUND", (0,0), (-1,0), ORANGE),
    ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("TEXTCOLOR", (0,1), (-1,-1), INK),
    ("BOX", (0,0), (-1,-1), 0.5, colors.HexColor("#d9d2c7")),
    ("INNERGRID", (0,0), (-1,-1), 0.5, colors.HexColor("#e6e0d6")),
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
    ("TOPPADDING", (0,0), (-1,-1), 6), ("BOTTOMPADDING", (0,0), (-1,-1), 6),
    ("LEFTPADDING", (0,0), (-1,-1), 8),
]))
story.append(rev)

# ---------- footer ----------
def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(GREY)
    canvas.drawString(0.75*inch, 0.5*inch, COMPANY + "  ·  SOP-PS-001  ·  " + PROJECT)
    canvas.drawRightString(LETTER[0]-0.75*inch, 0.5*inch, "Page %d" % doc.page)
    canvas.setStrokeColor(colors.HexColor("#e6e0d6"))
    canvas.line(0.75*inch, 0.68*inch, LETTER[0]-0.75*inch, 0.68*inch)
    canvas.restoreState()

doc = BaseDocTemplate(OUT, pagesize=LETTER,
                      leftMargin=0.75*inch, rightMargin=0.75*inch,
                      topMargin=0.7*inch, bottomMargin=0.8*inch,
                      title="SOP — Panel Scanning & QC (Midway)", author=AUTHOR)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=footer)])
doc.build(story)
print("WROTE", OUT, os.path.getsize(OUT), "bytes")
