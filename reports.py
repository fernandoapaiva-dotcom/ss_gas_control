import os
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from datetime import datetime

LOGO_PATH = os.path.join(os.path.dirname(__file__), 'assets', 'logo', 'SERVSOLDAPNG.png')

def generate_delivery_pdf(delivery_data, client_data, cilindros, output_path):
    doc = SimpleDocTemplate(output_path, pagesize=A4, rightMargin=2*cm, leftMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
    elements = []
    styles = getSampleStyleSheet()
    
    # Header with Logo
    if os.path.exists(LOGO_PATH):
        img = Image(LOGO_PATH, width=5*cm, height=2*cm)
        img.hAlign = 'CENTER'
        elements.append(img)
        elements.append(Spacer(1, 0.5*cm))

    # Title
    title_style = ParagraphStyle('TitleStyle', parent=styles['Heading1'], alignment=1, textColor=colors.black)
    elements.append(Paragraph("RELATÓRIO DE ENTREGA DE GASES", title_style))
    elements.append(Spacer(1, 1*cm))

    # Client Info Table
    client_table_data = [
        [Paragraph(f"<b>Cliente:</b> {client_data.nome_razao}", styles['Normal']), Paragraph(f"<b>CNPJ:</b> {client_data.cnpj}", styles['Normal'])],
        [Paragraph(f"<b>Documento:</b> {delivery_data.numero_documento}", styles['Normal']), Paragraph(f"<b>Data:</b> {delivery_data.data_entrega.strftime('%d/%m/%Y') if delivery_data.data_entrega else ''}", styles['Normal'])]
    ]
    client_table = Table(client_table_data, colWidths=[10*cm, 7*cm])
    client_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    elements.append(client_table)
    elements.append(Spacer(1, 1*cm))

    # Cylinders Table
    headers = ["Item", "Gás", "Tamanho", "Qtd", "Validade"]
    data = [headers]
    for idx, c in enumerate(cilindros, 1):
        # Handle both object and dict
        tipo = c.tipo_gas if hasattr(c, 'tipo_gas') else c.get('tipo_gas')
        tam = c.tamanho_gas if hasattr(c, 'tamanho_gas') else c.get('tamanho_gas')
        qtd = c.quantidade if hasattr(c, 'quantidade') else c.get('qtd')
        val = c.data_validade if hasattr(c, 'data_validade') else c.get('validade')
        data.append([str(idx), tipo, tam, str(qtd), val])

    table = Table(data, colWidths=[2*cm, 5*cm, 4*cm, 2*cm, 4*cm])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1b2924')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('GRID', (0, 0), (-1, -1), 1, colors.black),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.whitesmoke, colors.white])
    ]))
    elements.append(table)
    elements.append(Spacer(1, 2*cm))

    # Footer
    # The original instruction contained a syntactically incorrect snippet for canvas operations.
    # To faithfully apply the "Fix system name" while maintaining valid Python and ReportLab structure,
    # the footer text is updated within a Paragraph element.
    elements.append(Paragraph("SS Gas Control - Relatório Automatizado", styles['Italic']))
    
    doc.build(elements)
    return output_path
